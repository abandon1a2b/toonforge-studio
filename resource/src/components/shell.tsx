import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Layers,
  Upload,
  Settings,
  Search,
  Menu,
  ClipboardCheck,
  FolderInput,
  Tags,
  Archive,
  Activity,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { get } from "@/lib/api";
import { type Job } from "@/lib/types";
const links = [
  ["/", "工作台"],
  ["/library/character", "角色"],
  ["/library/scene", "场景"],
  ["/library/story", "剧本"],
  ["/library/public", "公共素材"],
];
const management = [
  ["/import", "导入与待整理", FolderInput],
  ["/reviews", "审阅中心", ClipboardCheck],
  ["/manage/tags", "分类与分组", Tags],
  ["/manage/archive", "已归档", Archive],
  ["/manage/tasks", "后台任务", Activity],
  ["/manage/settings", "数据与备份", Settings],
] as const;
export function Shell() {
  const [mobile, setMobile] = useState(false);
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => get<{ items: Job[] }>("jobs", {}, signal),
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => ["running", "queued"].includes(j.status))
        ? 1500
        : false,
  });
  const active =
    jobs.data?.items.filter((j) => ["running", "queued"].includes(j.status))
      .length || 0;
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          <Layers />
          <span>
            toonforge<small>STUDIO</small>
          </span>
        </Link>
        <nav className="desktop-nav">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/search" aria-label="搜索素材库">
              <Search size={16} />
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/import">
              <Upload size={15} />
              <span>导入</span>
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="account-button">
                个人空间 {active > 0 && <b>{active}</b>}
                <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {management.map(([to, label, Icon], i) => (
                <div key={to}>
                  {i === 2 && <DropdownMenuSeparator />}
                  <DropdownMenuItem asChild>
                    <Link to={to}>
                      <Icon size={15} />
                      {label}
                    </Link>
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Sheet open={mobile} onOpenChange={setMobile}>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="mobile-menu"
                aria-label="打开导航"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>创作空间</SheetTitle>
              </SheetHeader>
              <nav className="mobile-nav">
                {[...links, ...management.map(([a, b]) => [a, b])].map(
                  ([to, label]) => (
                    <Link to={to} key={to} onClick={() => setMobile(false)}>
                      {label}
                    </Link>
                  ),
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>TOONFORGE STUDIO · 本地创作素材库</span>
        <Link to="/manage/settings">资料、版本与备份</Link>
      </footer>
    </>
  );
}
