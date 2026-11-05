import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon, BrandMark, HalftoneArt, PageMotion } from "../visuals";
import { EconomicsExample } from "./economics";
import "./learn.css";

export const metadata: Metadata = {
  title: "How Bisharp works | Cross-chain orders & solver economics",
  description:
    "Explore Bisharp's price-triggered cross-chain orders, solver-funded execution, receipt-based settlement, and the costs that determine potential margins.",
};

export default function HowItWorks() {
  return (
    <>
      <PageMotion />
      <a className="skip-link" href="#project">
        Skip to project explanation
      </a>
      <header className="topbar learn-topbar">
        <Link className="brand" href="/" aria-label="Bisharp app">
          <BrandMark />
          bisharp<span className="brand-dot">.</span>
        </Link>
        <nav aria-label="Project navigation">
          <a href="#settlement">How it works</a>
          <a href="#economics">Economics</a>
          <a href="#difference">The difference</a>
        </nav>
        <Link className="primary" href="/">
          Open app <ArrowIcon />
        </Link>
      </header>
      <main className="learn-page" id="project">
        <section className="page-intro">
          <div className="hero-copy">
            <div className="intro-kicker">
              <span className="small-tag">Meet Bisharp</span>
              <span>Cross-chain orders, explained.</span>
            </div>
            <h1>
              <span>Your price.</span>
              <span>Across</span>
              <span>chains.</span>
            </h1>
            <p>
              Define what you want to receive, where you want it, and when the
              price is right. A solver funds the destination trade. An
              authenticated receipt unlocks payment.
            </p>
            <div className="hero-actions">
              <Link className="primary" href="/">
                Try the app <ArrowIcon />
              </Link>
              <a className="secondary" href="#settlement">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className="hero-footnote">
              Currently on testnets. Built for explicit, verifiable terms.
            </div>
          </div>
          <HalftoneArt />
        </section>

        <div className="learn-foundations">
          <div>
            <span>Messages & receipts</span>
            <a
              href="https://chain.link/cross-chain"
              target="_blank"
              rel="noreferrer"
            >
              Chainlink CCIP ↗
            </a>
          </div>
          <div>
            <span>Destination swaps</span>
            <a href="https://uniswap.org/" target="_blank" rel="noreferrer">
              Uniswap v3 ↗
            </a>
          </div>
          <div>
            <span>Current public route</span>
            <p>Ethereum Sepolia → OP Sepolia</p>
          </div>
        </div>

        <section className="learn-section" id="settlement" data-reveal>
          <div className="learn-section-heading">
            <h2>
              One order.
              <br />
              Three clear steps.
            </h2>
            <p>
              Bisharp separates the intent, the trade, and the payment. Each
              stage has a confirmation you can inspect.
            </p>
          </div>
          <ol className="learn-steps">
            <li>
              <span className="learn-step-number">01</span>
              <span className="small-tag">Source chain</span>
              <h3>Set your terms.</h3>
              <p>
                Choose your principal, maximum trigger price, minimum WETH
                output, recipient, expiry, and designated solver. Approve the
                test token, then lock it in escrow.
              </p>
              <div className="learn-step-end">
                Your order is sent through CCIP <ArrowIcon />
              </div>
            </li>
            <li>
              <span className="learn-step-number">02</span>
              <span className="small-tag">Destination chain</span>
              <h3>The solver delivers.</h3>
              <p>
                After registration, the designated solver supplies its own
                destination tokens. Uniswap executes the swap only when the
                fresh oracle trigger and minimum output checks pass.
              </p>
              <div className="learn-step-end">
                Output goes to your fixed recipient <ArrowIcon />
              </div>
            </li>
            <li>
              <span className="learn-step-number">03</span>
              <span className="small-tag">Return receipt</span>
              <h3>Proof unlocks payment.</h3>
              <p>
                A terminal receipt returns through CCIP. Its authenticated
                arrival makes the source payment claimable by the solver—or
                makes a confirmed cancellation refundable to the owner.
              </p>
              <div className="learn-step-end">
                Claim the verified entitlement <ArrowIcon />
              </div>
            </li>
          </ol>
          <div className="learn-settlement-note">
            <BrandMark />
            <p>
              <strong>Your escrow principal stays on the source chain.</strong>{" "}
              The solver supplies destination liquidity. Execution and source
              payment are separate events, connected by an authenticated
              receipt.
            </p>
          </div>
        </section>

        <section className="learn-section" id="economics" data-reveal>
          <div className="learn-section-heading">
            <h2>
              Where the
              <br />
              upside comes from.
            </h2>
            <p>
              There is no fixed yield. Traders control the conditions of a
              purchase; solvers look for a payment that exceeds the full cost of
              fulfilling it.
            </p>
          </div>
          <div className="learn-benefits">
            <article>
              <span className="small-tag">For traders</span>
              <h3>A trade on your terms.</h3>
              <p>
                A price trigger and minimum output let you define an acceptable
                purchase before committing to execution. You can spend less time
                watching the market, but a trigger does not guarantee a fill—or
                a profitable position.
              </p>
              <p className="learn-equation">
                Received asset value − principal − your costs
              </p>
            </article>
            <article>
              <span className="small-tag">For solvers</span>
              <h3>A spread worth filling.</h3>
              <p>
                The source principal is the solver’s payment after a verified
                fill. Potential margin comes from the difference between that
                payment and destination funding, execution, messaging, and
                capital costs.
              </p>
              <p className="learn-equation">
                Source payment − destination funding − total costs
              </p>
            </article>
          </div>
          <EconomicsExample />
        </section>

        <section
          className="learn-section learn-difference"
          id="difference"
          data-reveal
        >
          <div className="learn-section-heading">
            <h2>
              Designed around
              <br />
              the outcome.
            </h2>
            <p>
              The distinctive part is the combination: user-defined conditions,
              solver-funded delivery, and source settlement tied to a verifiable
              destination result.
            </p>
          </div>
          <div className="learn-features">
            <article>
              <span className="feature-symbol" aria-hidden="true">
                ⇄
              </span>
              <h3>Separate the capital.</h3>
              <p>
                The user escrows on one chain; the solver funds the other.
                Destination execution does not require transferring the user’s
                principal between chains.
              </p>
            </article>
            <article>
              <span className="feature-symbol" aria-hidden="true">
                ≤
              </span>
              <h3>Bind the exact intent.</h3>
              <p>
                The recipient, solver, amounts, price condition, deadline, and
                route are part of the committed terms. A fill must satisfy both
                the oracle check and the minimum-output constraint.
              </p>
            </article>
            <article>
              <span className="feature-symbol" aria-hidden="true">
                ↳
              </span>
              <h3>Pay against a receipt.</h3>
              <p>
                A destination fill alone does not release source funds. The
                source validates the return message and allocates one
                entitlement for the final result.
              </p>
            </article>
            <article>
              <span className="feature-symbol" aria-hidden="true">
                ↻
              </span>
              <h3>Make recovery explicit.</h3>
              <p>
                Stored terminal receipts can be dispatched or retried. Claims
                and fee refunds are separate actions, so a stalled step remains
                visible rather than being mistaken for completion.
              </p>
            </article>
          </div>
        </section>

        <section className="learn-section learn-faq" data-reveal>
          <div>
            <span className="small-tag">Before your first order</span>
            <h2>
              A few things
              <br />
              to know.
            </h2>
            <p>Clear expectations are part of the product.</p>
          </div>
          <div className="learn-questions">
            <details>
              <summary>Is Bisharp profitable?</summary>
              <p>
                There is no guaranteed profit or fixed return. A solver can have
                a positive margin when source payment exceeds funding and all
                associated costs. A trader’s eventual result also depends on the
                received asset’s value. The calculator above is hypothetical;
                testnet tokens are not real earnings.
              </p>
            </details>
            <details>
              <summary>Does an order execute automatically?</summary>
              <p>
                The contract enforces your conditions when the designated solver
                submits a fill. Someone still has to fund and send that
                transaction. The current release does not guarantee a solver, a
                fill, or an execution time.
              </p>
            </details>
            <details>
              <summary>What happens if I cancel?</summary>
              <p>
                A source cancellation request is sent to the destination. A fill
                can arrive first; the first confirmed terminal outcome wins. The
                authenticated cancellation receipt must reach the source before
                the refund becomes claimable.
              </p>
            </details>
            <details>
              <summary>What costs should I include?</summary>
              <p>
                Include the costs you pay for approvals, creation, execution,
                receipt dispatch, and claims, plus swap fees and price impact
                where applicable. Native message fees are separate from the
                principal. Capital can remain locked while messages are delayed.
              </p>
            </details>
            <details>
              <summary>What has been validated so far?</summary>
              <p>
                The project has local settlement tests, and the Ethereum Sepolia
                and OP Sepolia contracts are deployed, source-verified, and
                paired. A full public CCIP order round trip has not yet been
                validated. This remains an unaudited testnet release; bUSD is an
                unbacked faucet token.
              </p>
            </details>
          </div>
        </section>

        <section className="closing-section" data-reveal>
          <span className="small-tag">Explore it with test funds</span>
          <div>
            <h2>
              Make your
              <br />
              next move.
            </h2>
            <Link
              className="closing-link"
              href="/"
              aria-label="Open trading app"
            >
              <ArrowIcon />
            </Link>
          </div>
          <p>The workspace is ready when you are.</p>
          <Link className="secondary learn-closing-cta" href="/">
            Open Bisharp <ArrowIcon />
          </Link>
        </section>
        <footer>
          <Link className="footer-brand" href="/">
            <BrandMark />
            bisharp.
          </Link>
          <span>Testnet release. No guaranteed fills or returns.</span>
          <div>
            <Link href="/">Open app</Link>
            <a
              href="https://github.com/Samarth208P/bisharp"
              target="_blank"
              rel="noreferrer"
            >
              Source code ↗
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}
