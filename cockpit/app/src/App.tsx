import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { ErrorBoundary, LocationProvider, Route, Router, lazy, useLocation } from "preact-iso";
import { listMessages, watchMessages } from "./api/cockpit";
import type { Message } from "./api/types";
import { Shell } from "./components/Shell";
import { Szene } from "./components/Szene";
import { Loading } from "./components/ui";
import { usePasswordRecovery } from "./hooks/recovery";
import { AdminContext, useAdminStatus } from "./hooks/role";
import { useSession } from "./hooks/useSession";
import { describeError } from "./lib/errors";
import { istKommandozentrale } from "./lib/pfadregel";
import { Assistent } from "./pages/Assistent";
import { Auffangen } from "./pages/Kommandozentrale/Auffangen";
import { RadarAuditor } from "./pages/RadarAuditor";
import { Einstellungen } from "./pages/Einstellungen";
import { SetPassword } from "./pages/SetPassword";
import { SignIn } from "./pages/SignIn";
import { Zentrale } from "./pages/Zentrale";

const Kommandozentrale = lazy(() => import("./pages/Kommandozentrale/Kommandozentrale").then((modul) => modul.Kommandozentrale));

function NotFound() {
  return <p class="muted">Diese Seite gibt es nicht. <a href="/">Zur Zentrale</a></p>;
}

export function App() {
  return (
    <LocationProvider>
      <Weiche />
    </LocationProvider>
  );
}

function Weiche() {
  const { path } = useLocation();
  if (istKommandozentrale(path)) {
    return (
      <Auffangen>
        <ErrorBoundary>
          <Kommandozentrale />
        </ErrorBoundary>
      </Auffangen>
    );
  }
  return <Cockpit />;
}

function Cockpit() {
  const session = useSession();
  return (
    <>
      <Szene leise={session !== null && session !== undefined} />
      <Inhalt session={session} />
    </>
  );
}

function Inhalt({ session }: { session: ReturnType<typeof useSession> }) {
  const recovery = usePasswordRecovery();
  const admin = useAdminStatus(session?.user.id);
  if (session === undefined) {
    return (
      <main class="page">
        <Loading />
      </main>
    );
  }
  if (session === null) return <SignIn />;
  if (recovery.pending) return <SetPassword onDone={recovery.finish} />;
  return (
    <AdminContext.Provider value={admin}>
      <Arbeitsbereich email={session.user.email ?? ""} admin={admin} />
    </AdminContext.Provider>
  );
}

export interface Feed {
  messages: Message[] | undefined;
  error: string | null;
  reload: () => void;
}

const FeedContext = createContext<Feed>({ messages: undefined, error: null, reload: () => undefined });

export function useFeedContext(): Feed {
  return useContext(FeedContext);
}

function useFeed(enabled: boolean): Feed {
  const [messages, setMessages] = useState<Message[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    listMessages().then((next) => { setMessages(next); setError(null); }, (reason: unknown) => { setError(describeError(reason)); });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    reload();
    const stop = watchMessages(reload);
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);
  return { messages, error, reload };
}

function Arbeitsbereich({ email, admin }: { email: string; admin: boolean | undefined }) {
  const feed = useFeed(admin === true);
  const unread = feed.messages?.filter((message) => message.read_at === null).length ?? 0;
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (unread > 0) void navigator.setAppBadge(unread).catch(() => undefined);
    else void navigator.clearAppBadge().catch(() => undefined);
  }, [unread]);
  return (
    <FeedContext.Provider value={feed}>
      <Shell admin={admin} pending={unread}>
        {admin === false ? null : (
          <Router>
            <Route path="/" component={Zentrale} />
            <Route path="/radarauditor" component={RadarAuditor} />
            <Route path="/assistent" component={Assistent} />
            <Route path="/einstellungen" component={() => <Einstellungen email={email} />} />
            <Route default component={NotFound} />
          </Router>
        )}
      </Shell>
    </FeedContext.Provider>
  );
}
