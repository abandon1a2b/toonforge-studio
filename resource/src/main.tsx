import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/api";
import { Shell } from "@/components/shell";
import { Loading } from "@/components/shared";
import "./index.css";
const Home = lazy(() => import("@/pages/home"));
const Library = lazy(() => import("@/pages/library"));
const Entity = lazy(() => import("@/pages/entity"));
const Asset = lazy(() => import("@/pages/asset"));
const Import = lazy(() => import("@/pages/import"));
const Reviews = lazy(() => import("@/pages/reviews"));
const Manage = lazy(() => import("@/pages/manage"));
class AppError extends React.Component<
  React.PropsWithChildren,
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <h1>页面遇到错误</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </div>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppError>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<Loading />}>
                      <Home />
                    </Suspense>
                  }
                />
                <Route
                  path="library/:type"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Library />
                    </Suspense>
                  }
                />
                <Route
                  path="search"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Library search />
                    </Suspense>
                  }
                />
                <Route
                  path="entities/:id"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Entity />
                    </Suspense>
                  }
                />
                <Route
                  path="assets/:id"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Asset />
                    </Suspense>
                  }
                />
                <Route
                  path="import"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Import />
                    </Suspense>
                  }
                />
                <Route
                  path="reviews"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Reviews />
                    </Suspense>
                  }
                />
                <Route
                  path="manage/:tab"
                  element={
                    <Suspense fallback={<Loading />}>
                      <Manage />
                    </Suspense>
                  }
                />
                <Route
                  path="*"
                  element={<p>页面不存在，请从顶部导航继续。</p>}
                />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </AppError>
  </React.StrictMode>,
);
