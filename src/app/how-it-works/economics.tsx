"use client";

import { useState } from "react";
import {
  solverEconomics,
  formatScenarioDollars as dollars,
} from "@/lib/solver-economics";

const examples = [
  { label: "Positive margin", fees: "1" },
  { label: "Break-even", fees: "2" },
  { label: "Costs exceed spread", fees: "3" },
];

export function EconomicsExample() {
  const [payment, setPayment] = useState("100");
  const [funding, setFunding] = useState("98");
  const [fees, setFees] = useState("1");
  let result: ReturnType<typeof solverEconomics> | undefined;
  let error = "";
  try {
    result = solverEconomics(payment, funding, fees);
  } catch (reason) {
    error =
      reason instanceof Error ? reason.message : "Check the scenario amounts.";
  }
  const maximum = result
    ? Number(
        result.payment > result.totalCost ? result.payment : result.totalCost,
      )
    : 1;

  return (
    <div className="economics-example">
      <div className="economics-inputs">
        <span className="small-tag">
          Interactive example · not a live quote
        </span>
        <h3>Run the numbers.</h3>
        <p>
          Adjust a solver’s payment and costs. A wider spread only helps if it
          covers the full cost of execution.
        </p>
        <div className="economics-presets" aria-label="Example scenarios">
          {examples.map((example) => (
            <button
              key={example.label}
              type="button"
              aria-pressed={
                payment === "100" && funding === "98" && fees === example.fees
              }
              onClick={() => {
                setPayment("100");
                setFunding("98");
                setFees(example.fees);
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
        <div className="economics-fields">
          {[
            {
              id: "example-payment",
              label: "Source payment value ($)",
              value: payment,
              set: setPayment,
            },
            {
              id: "example-funding",
              label: "Destination funding cost ($)",
              value: funding,
              set: setFunding,
            },
            {
              id: "example-fees",
              label: "Execution & message costs ($)",
              value: fees,
              set: setFees,
            },
          ].map((field) => (
            <div key={field.id}>
              <label htmlFor={field.id}>{field.label}</label>
              <input
                id={field.id}
                className="recipient-input"
                inputMode="decimal"
                autoComplete="off"
                maxLength={10}
                value={field.value}
                aria-describedby="economics-assumptions"
                onChange={(event) => field.set(event.target.value)}
              />
            </div>
          ))}
        </div>
        <p id="economics-assumptions" className="economics-assumptions">
          Illustrative dollar equivalents only. Testnet bUSD has no real-dollar
          backing. Include gas, swap fees, price impact, and message fees in
          your cost assumption. Price changes and the cost of locked capital can
          reduce the result further.
        </p>
      </div>
      <div className="economics-result" aria-live="polite" aria-atomic="true">
        {result ? (
          <>
            <span className="economics-result-label">
              Illustrative net solver margin
            </span>
            <strong className="economics-value">
              {result.net > 0n ? "+" : ""}
              {dollars(result.net)}
            </strong>
            <span className="economics-verdict">
              {result.net > 0n
                ? "Positive under these assumptions"
                : result.net === 0n
                  ? "Break-even under these assumptions"
                  : "Execution costs more than it pays"}
            </span>
            <dl className="economics-breakdown">
              <div>
                <dt>Source payment</dt>
                <dd>{dollars(result.payment)}</dd>
              </div>
              <div>
                <dt>Destination funding</dt>
                <dd>−{dollars(result.funding)}</dd>
              </div>
              <div>
                <dt>Execution & messages</dt>
                <dd>−{dollars(result.fees)}</dd>
              </div>
              <div>
                <dt>Net scenario margin</dt>
                <dd>{dollars(result.net)}</dd>
              </div>
            </dl>
            <div className="economics-bars" aria-hidden="true">
              <div>
                <span>Payment</span>
                <i
                  style={{
                    width: `${(Number(result.payment) / maximum) * 100}%`,
                  }}
                />
              </div>
              <div>
                <span>Total cost</span>
                <i
                  style={{
                    width: `${(Number(result.totalCost) / maximum) * 100}%`,
                  }}
                />
              </div>
            </div>
            <p>
              Payment becomes claimable only after a valid fill receipt returns
              to the source. This example is not a promised return or realized
              profit.
            </p>
          </>
        ) : (
          <>
            <span className="economics-result-label">Check your scenario</span>
            <strong className="economics-value">—</strong>
            <p>{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
