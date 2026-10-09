import { useAppData } from "./context/AppData.jsx";
import { useRoute } from "./lib/router.js";
import { useTheme } from "./lib/theme.js";
import { FilterBar, NAV, Sidebar } from "./components/Shell.jsx";
import { StateMessage, ViewSkeleton } from "./components/ui.jsx";
import Overview from "./views/Overview.jsx";
import Trends from "./views/Trends.jsx";
import Patterns from "./views/Patterns.jsx";
import Records from "./views/Records.jsx";
import Garage from "./views/Garage.jsx";
import Activities from "./views/Activities.jsx";
import Admin from "./views/Admin.jsx";

const VIEWS = { overview: Overview, trends: Trends, patterns: Patterns, records: Records, garage: Garage, activities: Activities, admin: Admin };

function Gate({ viewId, children }) {
  const { status, error, serverMessage, reload } = useAppData();
  if (status === "loading") return <ViewSkeleton />;
  if (status === "unauth") {
    return (
      <div className="content">
        <StateMessage title="Not authenticated" actions={<a className="btn primary" href="/auth">Log in with Strava</a>}>
          The server has no Strava token yet. Log in once, then come back to this page.
        </StateMessage>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="content">
        <StateMessage title="Couldn’t load your data" actions={<button type="button" className="btn primary" onClick={() => reload()}>Retry</button>}>
          {error}
        </StateMessage>
      </div>
    );
  }
  if (status === "empty" && viewId !== "admin") {
    return (
      <div className="content">
        <StateMessage title="No cached data yet" actions={<a className="btn primary" href="#/admin">Go to Data</a>}>
          {serverMessage || "No local data available — populate from the API."} Run a full pull from the Data page to get started.
        </StateMessage>
      </div>
    );
  }
  return children;
}

export default function App() {
  const route = useRoute();
  const themeState = useTheme();
  const viewId = VIEWS[route.segments[0]] ? route.segments[0] : "overview";
  const View = VIEWS[viewId];
  const title = NAV.find(n => n.id === viewId)?.label;

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <Sidebar current={viewId} themeState={themeState} />
      <div className="main">
        <FilterBar />
        <main id="main-content" tabIndex={-1} aria-label={title} style={{ outline: "none" }}>
          <Gate viewId={viewId}>
            <View route={route} />
          </Gate>
        </main>
      </div>
    </div>
  );
}
