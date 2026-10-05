import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { source } from "../data/source";
import { config } from "../lib/config";
import { Logo } from "../components/ui";

const STEPS = [
  {
    title: "A sealed box rides with the produce",
    body: "It logs temperature, humidity, pressure, gas, jolts and movement all the way, and keeps going through network dead zones.",
  },
  {
    title: "Every reading is signed inside a security chip",
    body: "The chip's private key can never be copied out. Each record also carries the hash of the one before it, so editing, deleting or reordering anything shows up.",
  },
  {
    title: "The latest record is anchored on a public blockchain",
    body: "A smart contract on Polygon checks the chip's signature itself before it accepts the record. Nobody, including us, can rewrite what was locked.",
  },
  {
    title: "The buyer scans a QR and checks it on their own phone",
    body: "The page re-checks every hash and signature in the buyer's browser. No login, no app, and no need to trust us.",
  },
];

export function Landing() {
  const { email } = useAuth();
  return (
    <div className="landing">
      <header className="land-nav">
        <Logo />
        <nav>
          <a href="#how">How it works</a>
          <a href="#request">Request nodes</a>
          {email ? (
            <Link className="btn btn-primary" to="/app">Open dashboard</Link>
          ) : (
            <Link className="btn btn-primary" to="/login">Log in</Link>
          )}
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">Smart India Hackathon 2026 · Team AEGIS_X · Ministry of Food Processing Industries</p>
        <h1>Prove your produce stayed cold, and let your buyer check it themselves.</h1>
        <p className="lede">
          SAAKSHI is a low-cost sensor node that signs every reading inside a security chip and anchors it on a public blockchain.
          Your buyer verifies the whole journey from a QR code, without trusting you, us, or this website.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href="#request">Request nodes</a>
          <a className="btn btn-lg" href="#how">See how it works</a>
        </div>
        <dl className="hero-facts">
          <div><dt>Every 10 s to 15 min</dt><dd>reading interval, bench to field</dd></div>
          <div><dt>P-256 signature</dt><dd>from an ATECC608B chip, checked on-chain</dd></div>
          <div><dt>Polygon</dt><dd>public anchor anyone can read</dd></div>
        </dl>
      </section>

      <section className="section" id="how">
        <h2>How a shipment becomes verifiable</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section split">
        <div>
          <h2>The dashboard is for you, not for proof</h2>
          <p>
            This dashboard is a convenience for the owner of the nodes: see where each box is, watch temperature and jolts,
            get alerts, and share a QR with the buyer.
          </p>
          <p>
            It is never needed to prove a record is genuine. If this site went offline, every QR would keep working,
            because the verification page and the blockchain anchor stand on their own.
          </p>
        </div>
        <ul className="checklist">
          <li>Live status for every node, with last reading</li>
          <li>Temperature chart with your allowed band shaded</li>
          <li>Jolt and movement timeline</li>
          <li>Alerts for excursions, jolts, sensor swaps and tampering attempts</li>
          <li>One QR per trip for the buyer</li>
          <li>CSV export of any trip</li>
        </ul>
      </section>

      <section className="section request" id="request">
        <div>
          <h2>Request nodes</h2>
          <p>
            Tell us what you ship and how many nodes you need. There are no payments on this page; we will get in touch.
          </p>
          <p className="price">
            {config.priceInr ? `₹${config.priceInr.toLocaleString("en-IN")} per node` : "Price per node shared on request"}
          </p>
        </div>
        <RequestForm />
      </section>

      <footer className="land-foot">
        <Logo size={22} />
        <span>Team AEGIS_X · Problem statement 26232 · Low-cost IoT blockchain nodes for farm-to-fork traceability</span>
      </footer>
    </div>
  );
}

function RequestForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await source.submitOrder({
        name: String(f.get("name")).trim(),
        company: String(f.get("company")).trim(),
        phone: String(f.get("phone")).trim(),
        email: String(f.get("email")).trim(),
        nodes: Number(f.get("nodes")) || 1,
        product: String(f.get("product")).trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice notice-good" role="status">
        <strong>Request received.</strong>{" "}
        {source.mode === "demo"
          ? "This is demo mode, so it was saved only in this browser."
          : "We will contact you using the phone number or email you gave."}
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-row">
        <label>Your name<input name="name" required autoComplete="name" /></label>
        <label>Company<input name="company" required autoComplete="organization" /></label>
      </div>
      <div className="form-row">
        <label>Phone<input name="phone" type="tel" required autoComplete="tel" /></label>
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      </div>
      <div className="form-row">
        <label>Number of nodes<input name="nodes" type="number" min={1} defaultValue={1} required /></label>
        <label>Product you ship<input name="product" required placeholder="Mango, banana, dairy, fish" /></label>
      </div>
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Sending" : "Send request"}</button>
    </form>
  );
}
