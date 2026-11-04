// The frame around every page: sidebar, top bar with breadcrumbs, offline banner, the route's error boundary and
// focus management on navigation.
import { useEffect, useRef, type CSSProperties } from "react";
import logo from "@antifragicity/theme/assets/logo.svg";
import logoWhite from "@antifragicity/theme/assets/logo-white.svg";
import symbol from "@antifragicity/theme/assets/symbol.svg";
import { Outlet, useLocation } from "react-router";
import { Languages, ListChecks, MapPinned } from "lucide-react";
import {
  AppShell,
  Badge,
  Breadcrumbs,
  ErrorBoundary,
  ErrorPage,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  OfflineBanner,
  Sidebar,
  SidebarItem,
  SidebarSection,
  ThemeSwitch,
  TopBar,
  useOnlineStatus,
  useResolvedTheme,
  type Key,
} from "@rhoe/ui";
import { config } from "../config";
import { useJobs } from "../api/queries";
import { useLocale } from "../i18n";
import { PageMetaProvider, usePageMetaState } from "./page";

/** The AntifragiCity logos for the sidebar brand (see the workaround in app.css): red on light, white on dark. */
const brandLogos = (dark: boolean) => ({ "--atc-logo": `url("${dark ? logoWhite : logo}")`, "--atc-logo-symbol": `url("${symbol}")` }) as CSSProperties;

/** EN / EL in the top bar: one icon button with a menu, so phones keep room. */
export function LanguageMenu() {
  const { locale, setLocale, t } = useLocale();
  return (
    <MenuTrigger>
      <IconButton label={t.language} icon={<Icon icon={Languages} />} />
      <Menu
        aria-label={t.language}
        selectionMode="single"
        selectedKeys={[locale]}
        onSelectionChange={(keys) => {
          const k = [...(keys as Set<Key>)][0];
          if (k === "en" || k === "el") setLocale(k);
        }}
      >
        <MenuItem id="en" textValue="English">
          <span lang="en">English</span>
        </MenuItem>
        <MenuItem id="el" textValue="Ελληνικά">
          <span lang="el">Ελληνικά</span>
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

export function Shell() {
  const { t } = useLocale();
  const location = useLocation();
  const online = useOnlineStatus();
  const theme = useResolvedTheme();
  const [meta, setMeta] = usePageMetaState();
  const jobs = useJobs();
  const active = jobs.data?.items.filter((j) => j.status === "running" || j.status === "queued").length ?? 0;
  const path = location.pathname;
  const previous = useRef(path);
  const is = (prefix: string) => (prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/"));

  // After a client-side navigation, move focus to the new page's heading (or the main region). Not on first load.
  useEffect(() => {
    if (previous.current === path) return;
    previous.current = path;
    window.scrollTo(0, 0);
    let tries = 0;
    let frame = 0;
    const focus = () => {
      const h1 = document.querySelector<HTMLElement>("#rh-main h1");
      if (h1) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      } else if (tries++ < 30) frame = requestAnimationFrame(focus);
      else document.getElementById("rh-main")?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [path]);

  return (
    <PageMetaProvider onChange={setMeta}>
      <AppShell
        sidebar={
          <Sidebar productName={config.productName} homeHref="/" style={brandLogos(theme === "dark")} footer={<p className="atc-funding">{t.funding}</p>}>
            <SidebarSection title={t.nav.training}>
              <SidebarItem href="/" icon={MapPinned} isActive={is("/")}>
                {t.nav.perimeter}
              </SidebarItem>
              <SidebarItem href="/jobs" icon={ListChecks} isActive={is("/jobs")} badge={active || undefined} badgeLabel={t.nav.activeJobs(active)}>
                {t.nav.jobs}
              </SidebarItem>
            </SidebarSection>
          </Sidebar>
        }
        topBar={
          <TopBar
            start={meta.crumbs.length > 0 ? <Breadcrumbs items={meta.crumbs} /> : null}
            end={
              <>
                {config.environment && <Badge tone="warning">{config.environment}</Badge>}
                <LanguageMenu />
                <ThemeSwitch />
              </>
            }
          />
        }
      >
        <OfflineBanner isOnline={online} />
        <div className="app-page">
          <ErrorBoundary resetKeys={[path]} fallback={({ reset }) => <ErrorPage variant="500" fullHeight={false} onRetry={reset} homeHref="/" />}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </AppShell>
    </PageMetaProvider>
  );
}
