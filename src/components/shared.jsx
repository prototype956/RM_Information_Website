import React, {
  forwardRef,
  useRef,
  useEffect,
  useId,
  Children,
  cloneElement,
  isValidElement,
} from "react";
import {
  ArrowRight,
  Search,
  X,
  FolderOpen,
  FileText,
  Link2,
  Bookmark,
  AlertCircle,
} from "lucide-react";
import { useApp } from "../context";
import { size, date, format } from "../api";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertDescription } from "./ui/alert";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "./ui/table";

export const AppLink = forwardRef(function AppLink(
  { to, children, onClick, variant, ...props },
  ref,
) {
  const { go } = useApp();
  const link = (
    <a
      ref={ref}
      href={to}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (
          !e.defaultPrevented &&
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          props.target !== "_blank"
        ) {
          e.preventDefault();
          go(to);
        }
      }}
    >
      {children}
    </a>
  );
  return variant ? (
    <Button variant={variant} asChild>
      {link}
    </Button>
  ) : (
    link
  );
});
export const IconButton = forwardRef(function IconButton(
  { label, children, className, ...props },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          type="button"
          aria-label={label}
          className={cn("icon-button", className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});
export function Loading({ text = "正在加载资料…" }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span>{text}</span>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
export function ErrorBox({ children, id }) {
  return children ? (
    <Alert id={id} variant="destructive" className="error-box">
      <AlertCircle size={18} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  ) : null;
}
export const Mark = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect width="14" height="14" rx="2" />
    <rect x="18" width="14" height="14" rx="2" />
    <rect y="18" width="14" height="14" rx="2" />
    <path d="M18 18h14v14H18z" opacity=".3" />
    <path
      d="M20 28 28 20m-7 0h7v7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
);
export function Empty({ title, description, children }) {
  return (
    <div className="empty">
      <FolderOpen size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function SearchField({ value, onChange, onSubmit, large = false }) {
  return (
    <form
      className={cn("search-field", large && "large-search")}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search size={20} />
      <Input
        aria-label="搜索资料"
        data-search
        placeholder="搜索课程、技术方向或关键词…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <IconButton label="清空搜索" onClick={() => onChange("")}>
          <X size={16} />
        </IconButton>
      ) : (
        <kbd>/</kbd>
      )}
      {large && (
        <Button type="submit" size="icon" aria-label="搜索">
          <ArrowRight size={20} />
        </Button>
      )}
    </form>
  );
}
export function FileBadge({ resource }) {
  const f = format(resource);
  return (
    <div className="file-badge">
      {resource.kind === "link" ? <Link2 size={20} /> : <FileText size={20} />}
      <small>{f.length > 5 ? "FILE" : f}</small>
    </div>
  );
}
export function ResourceTable({ rows, grid = false }) {
  const { favorite, route } = useApp();
  const main = (r) => (
    <AppLink
      to={`/resources/${r.id}?from=${encodeURIComponent(route)}`}
      className="resource-main"
    >
      <FileBadge resource={r} />
      <div>
        <h3>
          {r.title}
          {!!r.hidden && <Badge variant="secondary">已下架</Badge>}
        </h3>
        <div className="resource-sub">
          <span>
            {r.kind === "link"
              ? "外部链接"
              : size(r.attachments.reduce((n, f) => n + f.size, 0))}
          </span>
          <span>·</span>
          <span>{r.sample ? "示例资料" : r.tags[0] || "队内共享"}</span>
        </div>
      </div>
    </AppLink>
  );
  const save = (r) => (
    <IconButton
      label={`${r.favorite ? "取消收藏" : "收藏"} ${r.title}`}
      className={r.favorite ? "saved" : ""}
      onClick={() => favorite(r)}
    >
      <Bookmark size={17} fill={r.favorite ? "currentColor" : "none"} />
    </IconButton>
  );
  const author = (r) => (
    <div className="resource-author">
      <Avatar className="tiny-avatar">
        <AvatarFallback>{r.author.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span>{r.author}</span>
    </div>
  );
  if (grid)
    return (
      <div className="resource-grid">
        {rows.map((r) => (
          <Card key={r.id} className="resource-row resource-card">
            {main(r)}
            <p className="card-description">
              {r.description || "暂未填写简介"}
            </p>
            <div className="resource-card-meta">
              <Badge variant="secondary">{r.category}</Badge>
              {save(r)}
            </div>
            <div className="resource-card-footer">
              {author(r)}
              <time>{date(r.updated_at)}</time>
            </div>
          </Card>
        ))}
      </div>
    );
  return (
    <div className="resource-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>资料名称</TableHead>
            <TableHead className="resource-category">分类 / 方向</TableHead>
            <TableHead className="author-cell">贡献者</TableHead>
            <TableHead className="date-cell">更新日期</TableHead>
            <TableHead className="save-cell">
              <span className="sr-only">收藏</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className={cn("resource-row", r.hidden && "hidden-resource")}
            >
              <TableCell>{main(r)}</TableCell>
              <TableCell className="resource-category">
                <Badge variant="secondary">{r.category}</Badge>
              </TableCell>
              <TableCell className="author-cell">{author(r)}</TableCell>
              <TableCell className="date-cell">
                <time dateTime={new Date(r.updated_at).toISOString()}>
                  {date(r.updated_at)}
                </time>
              </TableCell>
              <TableCell className="save-cell">{save(r)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
// One Radix select adapter keeps query updates and metadata form handlers unchanged.
export function Choice({ children, value, onChange, className, id, ...props }) {
  const options = Children.toArray(children)
    .flatMap((child) =>
      isValidElement(child) && child.type === React.Fragment
        ? Children.toArray(child.props.children)
        : [child],
    )
    .filter(isValidElement);
  const empty = "__rm_all__";
  return (
    <Select
      value={value || empty}
      onValueChange={(v) => {
        // Radix's form bridge can emit an empty value while options load.
        // The selectable empty option always uses our nonempty sentinel.
        if (v) onChange?.({ target: { value: v === empty ? "" : v } });
      }}
    >
      <SelectTrigger id={id} className={className} {...props}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => {
          const v = option.props.value ?? option.props.children;
          return (
            <SelectItem key={v || empty} value={v || empty}>
              {option.props.children}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
// Every field gets an explicit label and a stable hint relationship, including Radix controls.
export function Field({ children, className }) {
  const id = useId(),
    nodes = Children.toArray(children),
    control = nodes.find(
      (n) => isValidElement(n) && [Input, Choice, Textarea].includes(n.type),
    );
  const hint = nodes.find((n) => isValidElement(n) && n.type === "small");
  const label = nodes.filter((n) => n !== control && n !== hint);
  return (
    <div className={cn("field", className)}>
      <Label htmlFor={id}>{label}</Label>
      {control &&
        cloneElement(control, {
          id,
          "aria-describedby":
            [control.props["aria-describedby"], hint && `${id}-hint`]
              .filter(Boolean)
              .join(" ") || undefined,
        })}
      {hint && cloneElement(hint, { id: `${id}-hint` })}
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const previous = useRef(document.activeElement);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          previous.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>组合条件，找到需要的资料。</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function HeroTitle({ lines, motion = true }) {
  const ref = useRef();
  useEffect(() => {
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (max-width: 767px)",
    );
    let alive = true,
      context;
    const reset = () => {
      context?.revert();
      context = null;
    };
    if (motion && !media.matches)
      import("gsap")
        .then(({ gsap }) => {
          if (alive && !media.matches)
            context = gsap.context(
              () =>
                gsap.fromTo(
                  ".hero-line-inner",
                  { yPercent: 110 },
                  {
                    yPercent: 0,
                    duration: 0.7,
                    stagger: 0.1,
                    ease: "power4.out",
                  },
                ),
              ref,
            );
        })
        .catch(() => {});
    media.addEventListener("change", reset);
    return () => {
      alive = false;
      reset();
      media.removeEventListener("change", reset);
    };
  }, [motion]);
  return (
    <h1 ref={ref} className="display-title">
      {lines.map((line) => (
        <span className="hero-line" key={line}>
          <span className="hero-line-inner">{line}</span>
        </span>
      ))}
    </h1>
  );
}
