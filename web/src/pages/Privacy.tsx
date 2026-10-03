import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

export default function Privacy() {
  return (
    <>
      <div className="landing-top">
        <div className="inner">
          <Link to="/" className="brand">
            <Logo />
            FreightDesk
          </Link>
          <nav className="landing-nav">
            <Link to="/">Product overview</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/app" className="btn btn-primary btn-sm">
              Open the demo
            </Link>
          </nav>
        </div>
      </div>

      <div className="landing-wrap legal-copy">
        <h1>Privacy policy</h1>
        <p className="muted">Applies to this proof of concept build. Last updated 3 October 2026.</p>

        <h2>What this build is</h2>
        <p>
          FreightDesk is a proof of concept for requirement to payment automation in freight brokerage. It runs
          locally with sample data held in the memory of one API process. Nothing in this build is connected to a
          production CRM, a telephony provider or a WhatsApp Business account.
        </p>

        <h2>Data it holds</h2>
        <ul>
          <li>
            Sample customer records: company name, contact person, GST number and credit terms. These are invented
            for the demo.
          </li>
          <li>
            Sample vendor records: company name, phone and WhatsApp numbers in the format of Indian mobile numbers,
            operating hubs and corridors, fleet details and past performance figures. All invented for the demo.
          </li>
          <li>
            Requirement, quote, trip and invoice records created while you click through the demo.
          </li>
        </ul>
        <p>
          No real person's personal data is processed. If you type your own details into a field, they stay in this
          process and disappear when the server restarts.
        </p>

        <h2>Voice calls and messages</h2>
        <p>
          The AI voice agent and the Tamil WhatsApp messages are simulated inside the API process. No call is placed,
          no message is delivered, no audio is recorded, and no transcript leaves the machine. The message bodies and
          reply texts you see are strings generated for the demo.
        </p>

        <h2>Storage, retention and deletion</h2>
        <p>
          The store is in memory. Restarting the API resets it to the seeded sample data, which deletes everything
          created during your session. There is no database, no file persistence and no backup of session data.
        </p>

        <h2>Cookies, analytics and third parties</h2>
        <p>
          The build sets no cookies, loads no analytics, no fonts and no scripts from third parties. The only network
          calls the browser makes are to the API serving this page.
        </p>

        <h2>Your rights</h2>
        <p>
          Because this is a local demo with no persistence, there is nothing to export or erase on request. If this
          moves to production, the release will add access control, an audit trail for every call and message, and a
          defined retention window for transcripts and call recordings.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or the proof of concept go to the project team through the channel this build
          was shared with. Material changes will be recorded with a new date at the top of this page.
        </p>

        <p className="mt-3">
          <Link to="/">Back to the product overview</Link>
        </p>
      </div>
    </>
  );
}
