import React, { useEffect, useRef, useState } from "react";
import {
  Menu,
  Plus,
  ChevronDown,
  LayoutDashboard,
  FolderOpen,
  GraduationCap,
  Cpu,
  Bookmark,
  Upload,
  Users,
  LogOut,
  ArrowUpRight,
  ShieldCheck,
  X,
  Zap,
  Route,
} from "lucide-react";
import { useApp } from "../context";
import { AppLink, IconButton, Mark } from "./shared";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  useSidebar,
} from "./ui/sidebar";
function Navigation() {
  const { route, user, resources, taxonomy } = useApp(),
    { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [route]);
  const nav = (to, Icon, label, count) => (
    <SidebarMenuItem key={to}>
      <SidebarMenuButton
        asChild
        isActive={
          route === to || (to === "/roadmaps" && route.startsWith("/roadmaps"))
        }
        className="nav-link"
      >
        <AppLink
          to={to}
          aria-current={
            route === to ||
            (to === "/roadmaps" && route.startsWith("/roadmaps"))
              ? "page"
              : undefined
          }
        >
          <Icon />
          <span>{label}</span>
        </AppLink>
      </SidebarMenuButton>
      {count !== undefined && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
  return (
    <Sidebar className="sidebar" aria-label="资料导航">
      <SidebarHeader className="brand">
        <AppLink to="/" className="brand-link">
          <Mark />
          <span>
            <strong>
              RM <b>资料中心</b>
            </strong>
            <small>KNOWLEDGE BASE</small>
          </span>
        </AppLink>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭导航"
          className="nav-close"
          onClick={() => setOpenMobile(false)}
        >
          <X />
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <div className="workspace-label">
          <span className="live-dot" />
          队伍知识空间<span className="workspace-version">RM</span>
        </div>
        <SidebarGroup>
          <SidebarGroupLabel>知识空间</SidebarGroupLabel>
          <SidebarMenu>
            {nav("/", LayoutDashboard, "资料概览")}
            {nav("/roadmaps", Route, "学习路线")}
            {nav(
              "/resources",
              FolderOpen,
              "全部资料",
              resources.filter((r) => !r.hidden).length,
            )}
            {taxonomy.domains.map((d) =>
              nav(
                `/resources?domain=${d.id}`,
                d.id === "academic"
                  ? GraduationCap
                  : d.id === "rm"
                    ? Cpu
                    : FolderOpen,
                d.name,
              ),
            )}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>个人空间</SidebarGroupLabel>
          <SidebarMenu>
            {nav(
              "/favorites",
              Bookmark,
              "我的收藏",
              resources.filter((r) => r.favorite).length,
            )}
            {nav("/uploads", Upload, "我的上传")}
            {nav("/requests", FolderOpen, "我的选项申请")}
          </SidebarMenu>
        </SidebarGroup>
        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>队伍管理</SidebarGroupLabel>
            <SidebarMenu>
              {nav("/admin", Users, "成员与资料管理")}
              {nav("/admin/taxonomy", FolderOpen, "分类与标签管理")}
              {nav("/admin/taxonomy/requests", ShieldCheck, "选项申请审核")}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <div className="contribution">
          <span className="contribution-symbol">+</span>
          <strong>
            你的经验，
            <br />
            值得被看见。
          </strong>
          <p>
            一份笔记、一个链接，
            <br />
            都可能成为队友的下一步。
          </p>
          <AppLink to="/resources/new">
            分享一份资料
            <ArrowUpRight size={16} />
          </AppLink>
        </div>
        <div className="sidebar-foot">
          <ShieldCheck size={14} />
          仅限队伍成员访问
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
function Header({ logout }) {
  const { user, motion, setMotion, route } = useApp(),
    { setOpenMobile, openMobile, toggleSidebar } = useSidebar(),
    trigger = useRef(),
    wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !openMobile)
      requestAnimationFrame(() => trigger.current?.focus());
    wasOpen.current = openMobile;
  }, [openMobile]);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Button
          ref={trigger}
          variant="ghost"
          size="icon"
          aria-label="打开导航"
          className="mobile-menu"
          onClick={toggleSidebar}
        >
          <Menu />
        </Button>
        <span className="top-brand">RM WORKSPACE</span>
        <span className="top-divider">/</span>
        <span>{route.startsWith("/roadmaps") ? "学习路线" : "资料中心"}</span>
        <Badge variant="outline" className="private-tag">
          <span className="live-dot" />
          队伍内部
        </Badge>
      </div>
      <div className="top-actions">
        <div className="motion-control">
          <Label htmlFor="motion">
            <Zap size={15} />
            <span>动效</span>
          </Label>
          <Switch
            id="motion"
            aria-label="装饰动效"
            checked={motion}
            onCheckedChange={setMotion}
          />
        </div>
        <Button asChild className="top-upload">
          <AppLink to="/resources/new">
            <Plus size={16} />
            上传资料
          </AppLink>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="account-trigger"
              aria-label="账号菜单"
            >
              <Avatar>
                <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="account-popover">
            <DropdownMenuLabel>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <small>{user.role === "admin" ? "队伍管理员" : "队伍成员"}</small>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              className="mobile-motion-menu"
              checked={motion}
              onCheckedChange={setMotion}
            >
              装饰动效
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={logout}>
              <LogOut size={16} />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
export default function Shell({ children, logout }) {
  const { route } = useApp();
  const editor = /^\/roadmaps\/[^/]+\/edit/.test(route);
  const [sidebarOpen, setSidebarOpen] = useState(!editor);
  useEffect(() => setSidebarOpen(!editor), [editor]);
  return (
    <div
      className={`site-frame ${editor ? "roadmap-editor-shell" : ""} ${!sidebarOpen ? "sidebar-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className="app-shell"
        style={{ "--sidebar-width": "248px" }}
      >
        <Navigation />
        <div className="workspace">
          <Header logout={logout} />
          {children}
          <footer className="footer">
            <span>共享知识，一起进阶。</span>
            <span>
              <span className="live-dot" />
              RM TEAM KNOWLEDGE BASE
            </span>
          </footer>
        </div>
      </SidebarProvider>
    </div>
  );
}
