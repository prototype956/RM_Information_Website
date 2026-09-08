import React, { useState, useEffect, lazy, Suspense } from "react";
import { api, send } from "./api";
import { Context, useRoute } from "./context";
import { notify, Toaster } from "./components/notifications";
import { TooltipProvider } from "./components/ui/tooltip";
import { Button } from "./components/ui/button";
import { AppLink, Loading, ErrorBox, Empty } from "./components/shared";
import Shell from "./components/Shell";
import Auth from "./pages/Auth";
import Library from "./pages/Library";
import { emptyTaxonomy } from "./taxonomy/helpers";
const Detail = lazy(() => import("./pages/Detail"));
const ResourceForm = lazy(() => import("./pages/ResourceForm"));
const Admin = lazy(() => import("./pages/Admin"));
const RoadmapList = lazy(() => import("./roadmaps/List"));
const RoadmapReader = lazy(() => import("./roadmaps/Reader"));
const RoadmapEditor = lazy(() => import("./roadmaps/Editor"));
const TaxonomyManager = lazy(() => import("./taxonomy/Manager"));
const TaxonomyRequests = lazy(() => import("./taxonomy/Requests"));
export default function App() {
  const [taxonomy, setTaxonomy] = useState(emptyTaxonomy),
    [taxonomyError, setTaxonomyError] = useState("");
  const refreshTaxonomy = async () => {
    try {
      const result = await api("/taxonomy");
      setTaxonomy(result);
      setTaxonomyError("");
      return result;
    } catch (e) {
      setTaxonomyError(e.message);
      return null;
    }
  };
  const [route, go] = useRoute();
  const [user, setUser] = useState(null),
    [initial, setInitial] = useState(true),
    [setup, setSetup] = useState(false),
    [bootError, setBootError] = useState("");
  const [resources, setResources] = useState([]),
    [resourcesLoaded, setResourcesLoaded] = useState(false),
    [recent, setRecent] = useState([]),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState("");
  const [motion, setMotion] = useState(
    localStorage.getItem("rm-motion") !== "off",
  );
  const boot = async () => {
    setInitial(true);
    setBootError("");
    try {
      const status = await api("/auth/status");
      setSetup(status.setupNeeded);
      if (!status.setupNeeded) {
        try {
          const r = await api("/me");
          setUser(r.user);
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
    } catch (error) {
      setBootError(error.message);
    } finally {
      setInitial(false);
    }
  };
  useEffect(() => {
    boot();
    const expire = () => {
      setUser(null);
      setResources([]);
    };
    addEventListener("session-expired", expire);
    return () => removeEventListener("session-expired", expire);
  }, []);
  const refresh = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const r = await api("/resources");
      setResources(r.resources);
      setRecent(r.recent);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
      setResourcesLoaded(true);
    }
  };
  useEffect(() => {
    if (user) {
      refresh();
      refreshTaxonomy();
    }
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const reload = () => {
      refreshTaxonomy();
      refresh();
    };
    addEventListener("focus", reload);
    return () => removeEventListener("focus", reload);
  }, [user?.id]);
  useEffect(() => {
    localStorage.setItem("rm-motion", motion ? "on" : "off");
    document.documentElement.dataset.motion = motion ? "on" : "off";
  }, [motion]);
  useEffect(() => {
    document.title = route.startsWith("/roadmaps")
      ? "RM · 学习路线"
      : "RM · 资料中心";
  }, [route]);
  useEffect(() => {
    if (
      !loading &&
      resources.length &&
      /^\/(?:resources|favorites|uploads)?(?:\?|$)/.test(route)
    ) {
      const pos = sessionStorage.getItem(`scroll:${route}`);
      if (pos) requestAnimationFrame(() => window.scrollTo(0, Number(pos)));
    }
  }, [route, loading]);
  useEffect(() => {
    const keyboard = (e) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement.tagName,
        )
      ) {
        e.preventDefault();
        document.querySelector("[data-search]")?.focus();
      }
    };
    addEventListener("keydown", keyboard);
    return () => removeEventListener("keydown", keyboard);
  }, []);
  const favorite = async (r) => {
    try {
      const result = await send(`/resources/${r.id}/favorite`, {});
      setResources((rows) =>
        rows.map((x) =>
          x.id === r.id ? { ...x, favorite: result.favorite } : x,
        ),
      );
      notify(result.favorite ? "已加入我的收藏" : "已取消收藏");
    } catch (error) {
      notify(error.message);
    }
  };
  const logout = async () => {
    try {
      await send("/auth/logout", {});
      setUser(null);
      setResources([]);
      go("/");
    } catch (error) {
      notify(error.message);
    }
  };
  const ctx = {
    route,
    go,
    user,
    resources,
    recent,
    refresh,
    loading,
    resourceError: loadError,
    favorite,
    notify: notify,
    motion,
    setMotion,
    taxonomy,
    taxonomyError,
    refreshTaxonomy,
  };
  let page;
  if (initial) page = <Loading text="正在连接队伍资料中心…" />;
  else if (bootError)
    page = (
      <div className="boot-error">
        <ErrorBox>{bootError}</ErrorBox>
        <Button onClick={boot}>重新连接</Button>
      </div>
    );
  else if (!user || route.startsWith("/join/"))
    page = (
      <Auth
        setup={setup}
        onAuth={(u) => {
          setUser(u);
          setSetup(false);
          if (route.startsWith("/join/") || route === "/login") go("/", true);
        }}
      />
    );
  else {
    const pathname = route.split("?")[0];
    const match = pathname.match(/^\/resources\/([^/]+)(\/edit)?$/);
    const roadmapMatch = pathname.match(/^\/roadmaps\/([^/]+)(\/edit)?$/);
    let content;
    if (pathname === "/" || pathname === "/resources")
      content = <Library home={pathname === "/"} />;
    else if (pathname === "/resources/new") content = <ResourceForm />;
    else if (match)
      content = match[2] ? (
        <ResourceForm id={match[1]} />
      ) : (
        <Detail id={match[1]} />
      );
    else if (pathname === "/favorites" || pathname === "/uploads")
      content = <Library mode={pathname.slice(1)} />;
    else if (pathname === "/admin") content = <Admin />;
    else if (pathname === "/admin/taxonomy") content = <TaxonomyManager />;
    else if (pathname === "/requests") content = <TaxonomyRequests />;
    else if (pathname === "/admin/taxonomy/requests")
      content = <TaxonomyRequests review />;
    else if (pathname === "/roadmaps") content = <RoadmapList />;
    else if (roadmapMatch)
      content = roadmapMatch[2] ? (
        <RoadmapEditor id={roadmapMatch[1]} />
      ) : (
        <RoadmapReader id={roadmapMatch[1]} />
      );
    else
      content = (
        <Empty
          title="这个页面不在资料库中"
          description="检查链接，或回到资料中心继续浏览。"
        >
          <AppLink variant="default" to="/">
            返回资料中心
          </AppLink>
        </Empty>
      );
    page = (
      <Shell logout={logout}>
        <main id="main" className="main-content" key={pathname} tabIndex={-1}>
          {pathname.startsWith("/roadmaps") ||
          pathname.startsWith("/admin/taxonomy") ||
          pathname === "/requests" ? (
            <Suspense fallback={<Loading text="正在加载学习路线…" />}>
              {content}
            </Suspense>
          ) : loadError ? (
            <div className="load-error">
              <ErrorBox>{loadError}</ErrorBox>
              <Button variant="outline" onClick={refresh}>
                重新加载
              </Button>
            </div>
          ) : loading && !resources.length && !resourcesLoaded ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>{content}</Suspense>
          )}
        </main>
      </Shell>
    );
  }
  return (
    <Context.Provider value={ctx}>
      <TooltipProvider delayDuration={400}>
        {page}
        <Toaster />
      </TooltipProvider>
    </Context.Provider>
  );
}
