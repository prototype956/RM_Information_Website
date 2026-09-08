import React, {
  forwardRef,
  useState,
  useRef,
  useId,
  useImperativeHandle,
} from "react";
import { X, Plus, Tag } from "lucide-react";
import { useApp } from "../context";
import { send } from "../api";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ErrorBox, AppLink } from "../components/shared";
import RequestDialog from "./RequestDialog";
import { normalized } from "./helpers";
import "./taxonomy.css";
export const TagPicker = forwardRef(function TagPicker(
  { value = [], onChange, label = "标签" },
  ref,
) {
  const { taxonomy, refreshTaxonomy, user } = useApp(),
    id = useId(),
    root = useRef(),
    input = useRef();
  const [query, setQuery] = useState(""),
    [requestName, setRequestName] = useState(null),
    [notice, setNotice] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const matching = taxonomy.tags
      .filter(
        (t) =>
          !value.includes(t.id) &&
          normalized(t.name).includes(normalized(query)),
      )
      .slice(0, 8),
    exact = taxonomy.tags.find((t) => normalized(t.name) === normalized(query));
  const choices = [
    ...matching.map((t) => ({ id: t.id, label: t.name })),
    ...(query.trim() && !exact
      ? [
          {
            id: "create",
            label: `${user.role === "admin" ? "创建" : "申请新增"}“${query.trim()}”标签`,
          },
        ]
      : []),
  ];
  async function commit(text = query) {
    if (!text.trim()) return value;
    const names = [
      ...new Map(
        text
          .split(/[,，\n]/)
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => [normalized(n), n]),
      ).values(),
    ];
    const additions = names.filter(
      (name) =>
        !value.some(
          (id) =>
            normalized(taxonomy.tags.find((t) => t.id === id)?.name || "") ===
            normalized(name),
        ),
    );
    if (
      names.some((n) => n.length > 30) ||
      additions.length + value.length > 12
    ) {
      const e = Error("最多 12 个标签，每个不超过 30 字");
      setError(e.message);
      throw e;
    }
    const unknown = names.find(
      (name) =>
        !taxonomy.tags.some((t) => normalized(t.name) === normalized(name)),
    );
    if (unknown && user.role !== "admin") {
      setRequestName(unknown);
      const e = Error("新标签需要审核，请逐个提交申请；已有标签仍可直接选择。");
      setError(e.message);
      throw e;
    }
    setWorking(true);
    setError("");
    try {
      const ids = [...value];
      for (const name of names) {
        const existing = taxonomy.tags.find(
          (t) => normalized(t.name) === normalized(name),
        );
        const tag = existing || (await send("/taxonomy/tags", { name })).tag;
        if (!ids.includes(tag.id)) ids.push(tag.id);
      }
      onChange(ids);
      setQuery("");
      setActive(0);
      await refreshTaxonomy();
      return ids;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setWorking(false);
    }
  }
  useImperativeHandle(ref, () => ({ commit }), [query, value, taxonomy]);
  const choose = (choice) => {
    if (!choice) return;
    if (choice.id === "create") {
      commit().catch(() => {});
    } else {
      onChange([...value, choice.id]);
      setQuery("");
      setActive(0);
    }
    input.current?.focus();
  };
  return (
    <div
      ref={root}
      className="tag-picker"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Label htmlFor={id}>
        <Tag size={15} />
        {label}
      </Label>
      <div className="tag-chips">
        {value.map((tagId) => (
          <Badge key={tagId} variant="secondary">
            <span>
              {taxonomy.tags.find((t) => t.id === tagId)?.name || "失效标签"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`移除标签 ${taxonomy.tags.find((t) => t.id === tagId)?.name || "失效标签"}`}
              onClick={() => onChange(value.filter((x) => x !== tagId))}
            >
              <X size={14} />
            </Button>
          </Badge>
        ))}
      </div>
      <div className="tag-input-row">
        <Input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? `${id}-options` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && choices[active] ? `${id}-option-${active}` : undefined
          }
          aria-describedby={`${id}-hint${error ? " " + id + "-error" : ""}`}
          aria-invalid={!!error}
          value={query}
          disabled={working || value.length >= 12}
          placeholder="搜索已有标签，或输入新标签…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(choices.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            }
            if (e.key === "Escape") {
              setOpen(false);
              e.preventDefault();
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (choices[active] && open && !/[,，\n]/.test(query))
                choose(choices[active]);
              else commit().catch(() => {});
            }
            if (e.key === "Backspace" && !query && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={working || !query.trim()}
          onClick={() => commit().catch(() => {})}
          aria-label="添加输入的标签"
        >
          <Plus size={17} />
        </Button>
      </div>
      {open && (
        <div
          role="listbox"
          id={`${id}-options`}
          aria-label="可复用标签"
          className="tag-options"
        >
          {choices.map((choice, i) => (
            <Button
              type="button"
              key={choice.id}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === active}
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(choice)}
              disabled={working || value.length >= 12}
            >
              {choice.label}
            </Button>
          ))}
          {!choices.length && (
            <p>
              没有更多标签，可输入名称
              {user.role === "admin" ? "创建" : "申请新增"}。
            </p>
          )}
        </div>
      )}
      <small id={`${id}-hint`}>
        输入后按 Enter 添加，支持逗号批量输入。已选 {value.length} / 12。
        {user.role !== "admin" && " 新标签需逐个申请，审核通过后再选择。"}
      </small>
      {user.role !== "admin" && (
        <AppLink to="/requests" target="_blank" className="tag-request-link">
          查看我的申请
        </AppLink>
      )}
      {notice && (
        <span role="status" className="taxonomy-field-note">
          {notice}
        </span>
      )}
      {requestName !== null && (
        <RequestDialog
          initial={{ kind: "tag", name: requestName }}
          onClose={() => setRequestName(null)}
          onSuccess={({request}) => {
            setQuery(q=>q.split(/[,，\n]/).filter(name=>normalized(name)!==normalized(request.name)).join('，'));
            setError("");
            setNotice("申请已提交，尚未添加到当前内容。审核通过后可选择。");
          }}
        />
      )}
      <ErrorBox id={`${id}-error`}>{error}</ErrorBox>
      {working && <span role="status">正在添加标签…</span>}
    </div>
  );
});
