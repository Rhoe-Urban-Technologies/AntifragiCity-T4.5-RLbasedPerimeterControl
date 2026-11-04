// The training job's settings, in a drawer over the perimeter page. Defaults are the reference experiment's.
// Submitting sends the selection (Region A edges + light overrides); the server rebuilds and checks the perimeter.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Play } from "lucide-react";
import { Button, Drawer, Icon, NumberField, Select, Switch, TextField, toast } from "@rhoe/ui";
import { getErrorMessage, useApiMutation } from "@rhoe/data";
import { jobKeys, jobsApi, useDemandProfiles } from "../../api/queries";
import type { Analysis, Overrides, TrainingSettings } from "../../api/types";
import { useLocale } from "../../i18n";

export const DEFAULT_TRAINING: TrainingSettings = {
  episodes: 50,
  generators: 8,
  min_green: 5,
  noise: 2,
  seed: 42,
  sumo_seed: 42,
  exploration_seed: 10000,
  begin: 28800,
  duration: 3600,
  train_sample_size: 1000,
  critic_epochs: 128,
  critic_batch_size: 256,
  critic_validation_fraction: 0.2,
  critic_patience: 20,
  actor_steps: 2,
  target_update_period: 5,
};

interface TrainingDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: Analysis;
  overrides: Overrides;
  minGreen: number;
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;

export function TrainingDrawer({ isOpen, onOpenChange, analysis, overrides, minGreen }: TrainingDrawerProps) {
  const { t, fmt } = useLocale();
  const navigate = useNavigate();
  const profiles = useDemandProfiles();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("baseline");
  const [s, setS] = useState<TrainingSettings>(DEFAULT_TRAINING);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TrainingSettings>(k: K, v: number) => setS((p) => ({ ...p, [k]: Number.isNaN(v) ? DEFAULT_TRAINING[k] : v }));

  const create = useApiMutation({
    mutationFn: jobsApi.create,
    invalidate: () => [jobKeys.all],
    onSuccess: (job) => {
      toast.success(t.config.started(job.name));
      onOpenChange(false);
      navigate(`/jobs/${job._id}`);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const lights = analysis.lights.filter((l) => l.included).length;
  const nameValue = name.trim() || t.config.defaultName(lights, analysis.region_edge_count);
  const durationOk = s.duration % 90 === 0 && s.duration >= 90;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!durationOk) return;
    create.mutate({
      name: nameValue,
      region_a_edges: analysis.region_a_edges,
      overrides,
      demand_profile: profile,
      training: { ...s, min_green: minGreen },
    });
  };
  const selected = profiles.data?.items.find((p) => p.id === profile);

  return (
    <Drawer
      title={t.config.title}
      description={t.config.description(lights, analysis.region_edge_count)}
      size="md"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!create.isPending}
    >
      <form className="app-form" onSubmit={submit} noValidate>
        <section className="app-form-section">
          <TextField label={t.config.name} value={name} onChange={setName} placeholder={nameValue} description={t.config.nameHint} />
          <Select
            label={t.config.demand}
            options={(profiles.data?.items ?? []).map((p) => ({ id: p.id, label: p.name, description: t.config.trips(fmt.number(p.trips_08_09)) }))}
            selectedKey={profile}
            onSelectionChange={(k) => setProfile(String(k))}
            description={selected?.description}
          />
        </section>

        <section className="app-form-section">
          <h3>{t.config.run}</h3>
          <div className="app-form-grid">
            <NumberField label={t.config.episodes} description={t.config.episodesHint} value={s.episodes} onChange={(v) => set("episodes", v)} minValue={1} maxValue={1000} />
            <NumberField label={t.config.generators} description={t.config.generatorsHint} value={s.generators} onChange={(v) => set("generators", v)} minValue={1} maxValue={64} />
            <NumberField
              label={t.config.begin}
              description={t.config.beginHint(clock(s.begin))}
              value={s.begin}
              onChange={(v) => set("begin", v)}
              minValue={0}
              maxValue={86400}
              step={900}
              formatOptions={{ useGrouping: false }}
            />
            <NumberField
              label={t.config.duration}
              description={t.config.durationHint(s.duration / 90)}
              errorMessage={durationOk ? undefined : t.config.durationError}
              isInvalid={!durationOk}
              value={s.duration}
              onChange={(v) => set("duration", v)}
              minValue={90}
              maxValue={14400}
              step={90}
              formatOptions={{ useGrouping: false }}
            />
            <NumberField label={t.config.noise} description={t.config.noiseHint} value={s.noise} onChange={(v) => set("noise", v)} minValue={0} maxValue={20} step={0.5} />
            <NumberField label={t.config.seed} value={s.seed} onChange={(v) => set("seed", v)} formatOptions={{ useGrouping: false }} />
          </div>
          <p className="app-muted">{t.config.minGreenNote(minGreen)}</p>
        </section>

        <section className="app-form-section">
          <Switch isSelected={advanced} onChange={setAdvanced}>
            {t.config.advanced}
          </Switch>
          {advanced && (
            <div className="app-form-grid">
              <NumberField label={t.config.sumoSeed} value={s.sumo_seed} onChange={(v) => set("sumo_seed", v)} formatOptions={{ useGrouping: false }} />
              <NumberField label={t.config.explorationSeed} value={s.exploration_seed} onChange={(v) => set("exploration_seed", v)} formatOptions={{ useGrouping: false }} />
              <NumberField label={t.config.sampleSize} value={s.train_sample_size} onChange={(v) => set("train_sample_size", v)} minValue={2} />
              <NumberField label={t.config.criticEpochs} value={s.critic_epochs} onChange={(v) => set("critic_epochs", v)} minValue={1} />
              <NumberField label={t.config.criticBatch} value={s.critic_batch_size} onChange={(v) => set("critic_batch_size", v)} minValue={1} />
              <NumberField
                label={t.config.validation}
                value={s.critic_validation_fraction}
                onChange={(v) => set("critic_validation_fraction", v)}
                minValue={0.05}
                maxValue={0.95}
                step={0.05}
              />
              <NumberField label={t.config.patience} value={s.critic_patience} onChange={(v) => set("critic_patience", v)} minValue={1} />
              <NumberField label={t.config.actorSteps} value={s.actor_steps} onChange={(v) => set("actor_steps", v)} minValue={1} />
              <NumberField label={t.config.targetPeriod} value={s.target_update_period} onChange={(v) => set("target_update_period", v)} minValue={1} />
            </div>
          )}
        </section>

        {error && (
          <p className="atc-error" role="alert">
            {error}
          </p>
        )}
        <div className="app-form-actions">
          <Button type="submit" variant="primary" iconStart={<Icon icon={Play} />} isPending={create.isPending} isDisabled={!durationOk}>
            {t.config.submit}
          </Button>
          <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={create.isPending}>
            {t.common.cancel}
          </Button>
        </div>
        <p className="app-muted">{t.config.cost(s.episodes * s.generators, s.generators)}</p>
      </form>
    </Drawer>
  );
}
