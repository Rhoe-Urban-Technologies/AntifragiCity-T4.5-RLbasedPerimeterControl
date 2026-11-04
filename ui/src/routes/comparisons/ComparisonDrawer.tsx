// The settings of a comparison with fixed-time control, in a drawer over a training job's page.
// Defaults follow D4.5 (section 5.1): the training job's demand, the lowest, middle and highest B→A green of the
// action range, and the trained agent without exploration noise, all on SUMO seed 42.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Play, Plus, X } from "lucide-react";
import { Button, Drawer, Icon, IconButton, NumberField, Select, Switch, TextField, toast } from "@rhoe/ui";
import { getErrorMessage, useApiMutation } from "@rhoe/data";
import { comparisonKeys, comparisonsApi, useDemandProfiles } from "../../api/queries";
import type { TrainingJob } from "../../api/types";
import { useLocale } from "../../i18n";

interface ComparisonDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  job: TrainingJob;
}

/** "42, 43 44" → [42, 43, 44]; null when anything isn't a whole number or there are more than 10. */
export function parseSeeds(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.length > 10 || parts.some((p) => !/^-?\d+$/.test(p))) return null;
  return [...new Set(parts.map(Number))];
}

export function ComparisonDrawer({ isOpen, onOpenChange, job }: ComparisonDrawerProps) {
  const { t, fmt } = useLocale();
  const navigate = useNavigate();
  const profiles = useDemandProfiles();
  const [low, high] = job.perimeter.action_bounds;
  const [name, setName] = useState("");
  const [profile, setProfile] = useState(job.spec.demand_profile);
  const [budgets, setBudgets] = useState<number[]>([low, (low + high) / 2, high]);
  const [includeAgent, setIncludeAgent] = useState(job.has_agent);
  const [seedsText, setSeedsText] = useState("42");
  const [workers, setWorkers] = useState(4);
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation({
    mutationFn: comparisonsApi.create,
    invalidate: () => [comparisonKeys.all],
    onSuccess: (c) => {
      toast.success(t.compareForm.started(c.name));
      onOpenChange(false);
      navigate(`/comparisons/${c._id}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const seeds = parseSeeds(seedsText);
  const budgetOk = (b: number) => Number.isFinite(b) && b >= low && b <= high;
  const agent = includeAgent && job.has_agent;
  const nothing = budgets.length === 0 && !agent;
  const valid = seeds !== null && budgets.every(budgetOk) && !nothing;
  const controllers = new Set(budgets).size + (agent ? 1 : 0);
  const rounds = job.progress.rounds_done;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid) return;
    create.mutate({
      jobId: job._id,
      body: { name: name.trim() || undefined, demand_profile: profile, fixed_budgets: budgets, include_agent: agent, sumo_seeds: seeds, workers },
    });
  };
  const selected = profiles.data?.items.find((p) => p.id === profile);
  const range = [fmt.number(low), fmt.number(high)] as const;

  return (
    <Drawer title={t.compareForm.title} description={t.compareForm.description(job.name)} size="md" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!create.isPending}>
      <form className="app-form" onSubmit={submit} noValidate>
        <section className="app-form-section">
          <TextField label={t.compareForm.name} value={name} onChange={setName} description={t.compareForm.nameHint} />
          <Select
            label={t.compareForm.demand}
            options={(profiles.data?.items ?? []).map((p) => ({ id: p.id, label: p.name, description: t.config.trips(fmt.number(p.trips_08_09)) }))}
            selectedKey={profile}
            onSelectionChange={(k) => setProfile(String(k))}
            description={selected ? `${selected.description} ${t.compareForm.demandHint}` : t.compareForm.demandHint}
          />
        </section>

        <section className="app-form-section">
          <h3>{t.compareForm.budgets}</h3>
          <p className="app-muted">{t.compareForm.budgetsHint(...range)}</p>
          <ul className="atc-budgets">
            {budgets.map((b, i) => (
              <li key={i}>
                <NumberField
                  label={t.compareForm.budget(i + 1)}
                  value={b}
                  onChange={(v) => setBudgets((p) => p.map((x, j) => (j === i ? v : x)))}
                  minValue={low}
                  maxValue={high}
                  step={0.5}
                  isInvalid={!budgetOk(b)}
                  errorMessage={budgetOk(b) ? undefined : t.compareForm.budgetsHint(...range)}
                />
                <IconButton label={t.compareForm.removeBudget(i + 1)} icon={<Icon icon={X} />} onPress={() => setBudgets((p) => p.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          {budgets.length < 10 && (
            <div>
              <Button variant="secondary" size="sm" iconStart={<Icon icon={Plus} />} onPress={() => setBudgets((p) => [...p, (low + high) / 2])}>
                {t.compareForm.addBudget}
              </Button>
            </div>
          )}
        </section>

        <section className="app-form-section">
          <Switch isSelected={agent} onChange={setIncludeAgent} isDisabled={!job.has_agent}>
            {t.compareForm.agent}
          </Switch>
          <p className="app-muted">{job.has_agent ? t.compareForm.agentHint(rounds) : t.compareForm.noAgent}</p>
        </section>

        <section className="app-form-section">
          <div className="app-form-grid">
            <TextField
              label={t.compareForm.seeds}
              value={seedsText}
              onChange={setSeedsText}
              description={t.compareForm.seedsHint}
              isInvalid={seeds === null}
              errorMessage={seeds === null ? t.compareForm.seedsError : undefined}
              inputMode="numeric"
            />
            <NumberField label={t.compareForm.workers} description={t.compareForm.workersHint} value={workers} onChange={(v) => setWorkers(Number.isNaN(v) ? 4 : v)} minValue={1} maxValue={64} />
          </div>
        </section>

        {(error || nothing) && (
          <p className="atc-error" role="alert">
            {error ?? t.compareForm.nothing}
          </p>
        )}
        <div className="app-form-actions">
          <Button type="submit" variant="primary" iconStart={<Icon icon={Play} />} isPending={create.isPending} isDisabled={!valid}>
            {t.compareForm.submit}
          </Button>
          <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={create.isPending}>
            {t.common.cancel}
          </Button>
        </div>
        {seeds && <p className="app-muted">{t.compareForm.cost(controllers * seeds.length)}</p>}
      </form>
    </Drawer>
  );
}
