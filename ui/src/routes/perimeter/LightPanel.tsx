// The selected traffic light: include it or not, and the role of each green phase (detected, or set by hand).
import { RotateCcw, X } from "lucide-react";
import { Button, Card, CardHeader, Icon, IconButton, Select, StatusPill, Switch } from "@rhoe/ui";
import type { LightOverride, LightReport, PhaseRole } from "../../api/types";
import { useLocale } from "../../i18n";
import { LIGHT_TONE } from "./status";

interface LightPanelProps {
  light: LightReport;
  override: LightOverride | undefined;
  onChange: (next: LightOverride | undefined) => void;
  onClose: () => void;
}

/** A phase's signal state, one character per link: G/g green, y yellow, r red. */
function SignalState({ state }: { state: string }) {
  return (
    <code className="atc-state" aria-hidden="true">
      {[...state].map((ch, i) => (
        <span key={i} data-ch={ch.toLowerCase() === "g" ? "g" : ch === "y" || ch === "Y" ? "y" : "r"}>
          {ch}
        </span>
      ))}
    </code>
  );
}

export function LightPanel({ light, override, onChange, onClose }: LightPanelProps) {
  const { t, fmt } = useLocale();
  const roles = override?.roles ?? {};
  const setRole = (index: number, role: PhaseRole, detected: PhaseRole) => {
    const next = { ...roles };
    if (role === detected) delete next[String(index)];
    else next[String(index)] = role;
    onChange({ ...override, roles: next });
  };
  const roleOptions = (["ba", "ab", "fixed"] as const).map((r) => ({ id: r, label: t.phase.role[r] }));
  const canInclude = light.status !== "error";
  const changed = override && (override.include === false || Object.keys(roles).length > 0);

  return (
    <Card>
      <CardHeader
        level={2}
        title={t.light.title(light.id)}
        description={<StatusPill tone={LIGHT_TONE[light.status]}>{t.light.status[light.status]}</StatusPill>}
        actions={<IconButton label={t.common.close} icon={<Icon icon={X} />} size="sm" variant="ghost" onPress={onClose} />}
      />
      <div className="app-stack atc-gap-4">
        <dl className="app-facts">
          <div>
            <dt>{t.light.crossingsIn}</dt>
            <dd>{fmt.number(light.crossings_in)}</dd>
          </div>
          <div>
            <dt>{t.light.crossingsOut}</dt>
            <dd>{fmt.number(light.crossings_out)}</dd>
          </div>
          <div>
            <dt>{t.light.greenBudget}</dt>
            <dd>{t.common.seconds(fmt.number(light.green_budget))}</dd>
          </div>
          <div>
            <dt>{t.light.bounds}</dt>
            <dd>{light.bounds ? t.common.range(fmt.number(light.bounds[0]), fmt.number(light.bounds[1])) : "—"}</dd>
          </div>
        </dl>

        <Switch
          isSelected={light.included}
          isDisabled={!canInclude}
          onChange={(on) => onChange({ ...override, include: on ? null : false })}
        >
          {t.light.include}
        </Switch>

        {light.messages.length > 0 && (
          <ul className="atc-messages" aria-label={t.light.notes}>
            {light.messages.map((m) => (
              <li key={m} data-tone={light.status === "error" ? "danger" : "warning"}>
                {m}
              </li>
            ))}
          </ul>
        )}

        <div className="atc-phases" role="table" aria-label={t.phase.tableLabel(light.id)}>
          <div role="row" className="atc-phase atc-phase-head">
            <span role="columnheader">{t.phase.index}</span>
            <span role="columnheader">{t.phase.phaseLabel}</span>
            <span role="columnheader">{t.phase.roleLabel}</span>
          </div>
          {light.phases.map((p) => {
            const detected: PhaseRole = p.detected === "ba" || p.detected === "ab" ? p.detected : "fixed";
            return (
              <div role="row" className="atc-phase" key={p.index} data-green={p.green || undefined}>
                <span role="rowheader">{p.index}</span>
                <span role="cell" className="atc-phase-what">
                  <span>
                    {t.common.seconds(fmt.number(p.duration))} · {p.detected ? t.phase.detectedLabel[p.detected] : t.phase.clearance}
                  </span>
                  <SignalState state={p.state} />
                  <span className="app-sr-only">{t.phase.signals(p.state)}</span>
                </span>
                <span role="cell" className="atc-hidden-label">
                  {p.green ? (
                    <Select
                      label={t.phase.roleFor(p.index)}
                      size="sm"
                      options={roleOptions}
                      selectedKey={p.role}
                      onSelectionChange={(k) => setRole(p.index, k as PhaseRole, detected)}
                    />
                  ) : (
                    <span className="app-muted">{t.phase.role.fixed}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="app-muted">{t.phase.help}</p>
        {changed && (
          <div>
            <Button size="sm" variant="ghost" iconStart={<Icon icon={RotateCcw} size="sm" />} onPress={() => onChange(undefined)}>
              {t.light.reset}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
