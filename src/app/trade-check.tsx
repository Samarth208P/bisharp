"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import {
  calculateTradePlan,
  formatDecimal,
  type TradePlan,
} from "@/lib/trade-plan";
import { SelectField } from "./select-field";

const usd = (value: bigint) =>
  `${value < 0n ? "−" : ""}$${formatDecimal(value < 0n ? -value : value, 6)}`;
const price = (value: bigint) => `$${formatDecimal(value, 18)}`;
const boundPrice = (value: bigint) => {
  if (value < 10n ** 16n) return price(value);
  const cents = (value + 10n ** 16n - 1n) / 10n ** 16n;
  return `${value % 10n ** 16n ? "≈ " : ""}$${formatDecimal(cents, 2)}`;
};

export function TradeCheck({
  principal,
  amountIn,
  minOutput,
  livePrice,
  onMinimum,
  disabled,
  feeBudget,
  onFeeBudget,
  selfSolving,
}: {
  principal: string;
  amountIn: string;
  minOutput: string;
  livePrice: bigint | null;
  onMinimum: (value: string) => void;
  disabled: boolean;
  feeBudget: string;
  onFeeBudget: (value: string) => void;
  selfSolving: boolean;
}) {
  const [mode, setMode] = useState("live");
  const [scenario, setScenario] = useState("2000");
  const [haircut, setHaircut] = useState("100");
  const useLive = mode === "live" && livePrice !== null;
  let plan: TradePlan | undefined;
  let reference: bigint | null = livePrice;
  let error = "";
  try {
    if (!useLive) {
      if (!/^\d+(\.\d{1,18})?$/.test(scenario) || scenario.length > 40)
        throw new Error("Reference price: enter a positive decimal.");
      reference = parseUnits(scenario, 18);
    }
    plan = calculateTradePlan({
      principal: selfSolving ? amountIn : principal,
      amountIn,
      minOutput,
      oraclePrice: reference,
      feeBudgetUsd: feeBudget,
      slippageBps: Number(haircut),
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Check the trade amounts.";
  }
  const delta =
    plan?.minimumValueDeltaAfterFeesUsd ?? plan?.minimumValueDeltaUsd;

  return (
    <section className="trade-check" aria-labelledby="trade-check-title">
      <div className="trade-check-heading">
        <h2 id="trade-check-title">Check your trade</h2>
        <span className="small-tag">
          {useLive ? "Oracle reference" : "Scenario only"}
        </span>
      </div>
      <p className="trade-check-intro">
        See what your minimum really buys, before locking funds.
      </p>
      {selfSolving && (
        <p className="trade-check-basis">
          You are the solver. You fund both chains; the source principal returns
          to you after settlement. Costs below use your destination input.
        </p>
      )}
      <div className="trade-check-controls">
        <div>
          <label id="reference-mode-label" htmlFor="reference-mode">
            Price reference
          </label>
          <SelectField
            id="reference-mode"
            labelId="reference-mode-label"
            value={useLive ? "live" : "scenario"}
            options={[
              ...(livePrice !== null
                ? [{ value: "live", label: "Fresh oracle" }]
                : []),
              { value: "scenario", label: "My price scenario" },
            ]}
            onChange={setMode}
          />
        </div>
        {!useLive && (
          <div>
            <label htmlFor="scenario-price">Scenario ETH price ($)</label>
            <input
              id="scenario-price"
              className="recipient-input"
              inputMode="decimal"
              value={scenario}
              maxLength={40}
              onChange={(e) => setScenario(e.target.value)}
            />
          </div>
        )}
        <div className="trade-fee-input">
          <label htmlFor="fee-budget">Your total fee budget ($)</label>
          <input
            id="fee-budget"
            className="recipient-input"
            inputMode="decimal"
            value={feeBudget}
            maxLength={40}
            placeholder="Unknown · enter an estimate"
            onChange={(e) => onFeeBudget(e.target.value)}
            aria-describedby="fee-budget-help"
          />
          <p id="fee-budget-help">
            Include gas and message fees you expect to pay on both chains. This
            is a planning estimate, not a spending cap.
          </p>
        </div>
      </div>
      {error ? (
        <p className="trade-check-error" role="status">
          {error}
        </p>
      ) : (
        plan && (
          <>
            <dl className="trade-metrics">
              <div>
                <dt>Maximum price at your minimum</dt>
                <dd title={price(plan.effectiveMaxPrice)}>
                  {boundPrice(plan.effectiveMaxPrice)} <small>/ WETH</small>
                </dd>
              </div>
              {!selfSolving && (
                <div>
                  <dt>Solver spread before its costs</dt>
                  <dd>{usd(plan.solverSpreadUsd)}</dd>
                </div>
              )}
              <div>
                <dt>Your minimum at this reference</dt>
                <dd>
                  {plan.minimumValueUsd === null
                    ? "Unavailable"
                    : usd(plan.minimumValueUsd)}
                </dd>
              </div>
              <div>
                <dt>Break-even price including fees</dt>
                <dd
                  title={
                    plan.breakevenPrice === null
                      ? undefined
                      : price(plan.breakevenPrice)
                  }
                >
                  {plan.breakevenPrice === null
                    ? "Add fee budget"
                    : boundPrice(plan.breakevenPrice)}
                </dd>
              </div>
            </dl>
            {delta !== undefined && delta !== null && (
              <div
                className={`trade-outcome ${delta < 0n ? "trade-outcome-warning" : ""}`}
              >
                <strong>
                  {delta < 0n
                    ? `${usd(-delta)} below your ${plan.feeBudgetUsd === null ? "input cost" : "total budget"}`
                    : `${usd(delta)} above your ${plan.feeBudgetUsd === null ? "input cost" : "total budget"}`}
                </strong>
                <p>
                  Value of the minimum output at{" "}
                  {reference ? price(reference) : "this reference"}.{" "}
                  {plan.feeBudgetUsd === null
                    ? "Fees are excluded until you add a budget."
                    : "Includes your fee estimate."}{" "}
                  Actual output and future prices can differ.
                </p>
              </div>
            )}
            <details className="trade-scenarios">
              <summary>What if ETH moves 20%?</summary>
              <table>
                <caption>
                  Value of your minimum output, assuming it is filled. Not a
                  forecast.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">ETH price</th>
                    <th scope="col">Minimum value</th>
                    <th scope="col">
                      Vs.{" "}
                      {plan.totalCostUsd === null
                        ? "input cost"
                        : "total budget"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[80n, 100n, 120n].map((percent) => {
                    const scenarioPrice = (reference! * percent) / 100n;
                    const value = (plan.minOutput * scenarioPrice) / 10n ** 30n;
                    const difference =
                      value - (plan.totalCostUsd ?? plan.principal);
                    return (
                      <tr key={String(percent)}>
                        <th scope="row">
                          {price(scenarioPrice)}{" "}
                          <small>
                            (
                            {percent === 100n
                              ? "reference"
                              : percent === 80n
                                ? "−20%"
                                : "+20%"}
                            )
                          </small>
                        </th>
                        <td>{usd(value)}</td>
                        <td>
                          {difference >= 0n ? "+" : "−"}
                          {usd(difference >= 0n ? difference : -difference)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
            <div className="minimum-helper">
              <label id="haircut-label" htmlFor="reference-haircut">
                Reference output haircut
              </label>
              <div>
                <SelectField
                  id="reference-haircut"
                  labelId="haircut-label"
                  value={haircut}
                  options={[
                    { value: "50", label: "0.5%" },
                    { value: "100", label: "1%" },
                    { value: "200", label: "2%" },
                  ]}
                  onChange={setHaircut}
                />
                <button
                  type="button"
                  className="secondary compact"
                  disabled={disabled || plan.suggestedMinimumOutput === null}
                  onClick={() =>
                    plan?.suggestedMinimumOutput &&
                    onMinimum(formatDecimal(plan.suggestedMinimumOutput, 18))
                  }
                >
                  Use reference minimum
                </button>
              </div>
              <p>
                Oracle math only. Pool fees, liquidity and price impact are
                excluded. Review the applied minimum before signing.
              </p>
            </div>
            <ul className="trade-check-warnings">
              {plan.warnings
                .filter((w) => w.code !== "minimum-below-principal")
                .map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
            </ul>
          </>
        )
      )}
      <p className="trade-check-assumption">
        {!selfSolving && "Costs assume a separate solver. "}USD math assumes 1
        input token = $1. Test bUSD is unbacked. These scenarios do not promise
        savings, a fill, or a resale value.
      </p>
    </section>
  );
}
