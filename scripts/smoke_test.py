"""End to end smoke test for the FreightDesk API.

Drives one requirement through the whole flow the demo walks:
match, AI outreach, quote parsing, pricing, customer confirmation,
vendor lock-in, trip statuses, invoice, payment and vendor payout.

Usage: python scripts/smoke_test.py [base_url]
Requires the API to be running (npm run dev, or npm start after a build).
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4000/api"
FAILURES = []


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        payload = err.read().decode()
        raise RuntimeError(f"{method} {path} -> {err.code}: {payload}") from err


def check(label, condition, detail=""):
    mark = "ok  " if condition else "FAIL"
    print(f"[{mark}] {label}{(' ' + str(detail)) if detail else ''}")
    if not condition:
        FAILURES.append(label)


def wait_for(label, probe, timeout=35, interval=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(interval)
    check(label, False, "(timed out)")
    return None


def main():
    health = call("GET", "/health")
    check("api is up", health.get("ok") is True, health)

    req_id = "REQ-1006"

    detail = call("GET", f"/requirements/{req_id}")
    check("requirement starts at intake", detail["requirement"]["status"] == "intake")
    check("rate card answered instantly", detail["requirement"]["rateCardMatch"] == "exact",
          detail["requirement"]["rateCardRate"])

    detail = call("POST", f"/requirements/{req_id}/match", {})
    shortlist = detail["match"]["matched"] if detail["match"] else []
    check("shortlist produced", len(shortlist) >= 4, f"{len(shortlist)} vendors")
    check("shortlist is ranked", all(m["rank"] for m in shortlist))
    check("score within 0 to 100", all(0 <= m["score"] <= 100 for m in shortlist))
    check("excluded vendors carry reasons",
          all(e["reasons"] for e in detail["match"]["excluded"]) or detail["match"]["excludedCount"] == 0)

    detail = call("POST", f"/requirements/{req_id}/outreach", {})
    check("outreach started", detail["requirement"]["status"] == "outreach",
          f"{len(detail['attempts'])} attempts")

    detail = wait_for(
        "replies parsed into quotes",
        lambda: (lambda d: d if d["requirement"]["status"] == "quoted" else None)(
            call("GET", f"/requirements/{req_id}")
        ),
    )
    if not detail:
        return

    quotes = detail["quotes"]
    check("quotes received", len(quotes) >= 3, f"{len(quotes)} quotes")
    check("every quote parsed to a number or is flagged",
          all(q["rate"] is not None or q["flagReason"] for q in quotes))
    check("confidence scores are bounded",
          all(0 <= q["confidence"] <= 1 for q in quotes))

    summary = detail["summary"]
    check("L1 is the lowest usable quote", summary["l1"] is not None)
    if summary["l1"]:
        usable = [q for q in quotes if q["rate"] is not None and (q["flagReason"] is None or q["verified"])]
        check("L1 equals min of usable", summary["l1"]["normalisedRate"] == min(q["normalisedRate"] for q in usable))
        check("average above or equal to L1", summary["average"] >= summary["l1"]["normalisedRate"])
        check("spread computed", summary["spread"] is not None)

    flagged = [q for q in quotes if q["flagReason"] and not q["verified"]]
    for q in flagged:
        call("POST", f"/quotes/{q['id']}/verify", {})
    if flagged:
        check("flagged quotes verified by agent", True, f"{len(flagged)} verified")

    detail = call("POST", f"/requirements/{req_id}/pricing", {"marginPct": 8})
    check("priced for customer", detail["requirement"]["status"] == "awaiting_customer")
    check("customer price carries margin",
          detail["summary"]["customerPrice"] >= detail["summary"]["l1"]["normalisedRate"])

    detail = call("POST", f"/requirements/{req_id}/confirm", {})
    check("lock-in started", detail["requirement"]["status"] == "locking")

    detail = wait_for(
        "vendor accepted the job",
        lambda: (lambda d: d if d["order"] and d["order"]["status"] == "confirmed" else None)(
            call("GET", f"/requirements/{req_id}")
        ),
        timeout=30,
    )
    if not detail:
        return

    accepted = [a for a in detail["order"]["attempts"] if a["status"] == "accepted"]
    check("first valid acceptance wins", len(accepted) == 1)
    check("vehicle captured", bool(accepted and accepted[0]["vehicleNo"]))
    check("trip created", detail["trip"] is not None)
    trip_id = detail["trip"]["id"]
    check("requirement confirmed", detail["requirement"]["status"] == "confirmed")

    call("POST", f"/trips/{trip_id}/pod", {"file": f"POD_{trip_id}.pdf"})
    order = ["vehicle_assigned", "dispatched", "in_transit", "delivered", "billed", "paid"]
    for expected in order:
        res = call("POST", f"/trips/{trip_id}/advance", {})
        check(f"trip advances to {expected}", res["trip"]["status"] == expected, res["trip"]["status"])
        if expected == "billed":
            check("invoice raised at billing", res["invoice"] is not None)
            invoice_id = res["invoice"]["id"]
        if expected == "paid":
            check("invoice marked paid", res["invoice"]["status"] == "paid")

    payments = call("GET", "/payments")
    row = next((r for r in payments["rows"] if r["id"] == invoice_id), None)
    check("payment appears on the payments screen", row is not None)
    check("receivable cleared", row["status"] == "paid")

    call("POST", f"/payments/{invoice_id}/payout", {"status": "approved"})
    payout = call("POST", f"/payments/{invoice_id}/payout", {"status": "paid"})
    check("vendor payout released", payout["vendorPayoutStatus"] == "paid")

    metrics = call("GET", "/metrics")
    check("metrics computed", isinstance(metrics["avgMinutesToL1"], (int, float)), metrics)
    check("response rate computed", metrics["responseRatePct"] is not None, metrics["responseRatePct"])
    check("margin booked is positive", metrics["marginBooked"] > 0, metrics["marginBooked"])

    # A second requirement goes through intake with a rate card miss path.
    created = call("POST", "/requirements", {
        "customerName": "Meridian Plastics",
        "origin": "Vellore",
        "destination": "Kochi",
        "cargo": "General",
        "weightT": 7,
        "vehicleType": "container",
        "bodySizeFt": 22,
        "axle": "single",
        "loadingDate": "2026-10-06",
        "loadingTime": "07:00",
        "notes": "Smoke test requirement",
    })
    check("new requirement created", created["requirement"]["id"].startswith("REQ-"))
    check("rate card lookup ran on create", created["requirement"]["rateCardMatch"] in ("exact", "nearest", "none"))

    match = call("POST", f"/requirements/{created['requirement']['id']}/match", {})
    check("matching runs on the new requirement", match["match"] is not None)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} checks failed:")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("all smoke checks passed")


if __name__ == "__main__":
    main()
