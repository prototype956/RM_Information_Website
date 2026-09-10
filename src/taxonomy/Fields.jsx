import React, { useState } from "react";
import RequestDialog from "./RequestDialog";
import { useApp } from "../context";
import { Field, Choice, ErrorBox, AppLink } from "../components/shared";
import { Button } from "../components/ui/button";
import "./taxonomy.css";
export default function ClassificationFields({
  value,
  onChange,
  domainLabel = "所属资料库",
  categoryLabel = "分类",
}) {
  const { taxonomy, taxonomyError, refreshTaxonomy, user } = useApp();
  const [request, setRequest] = useState(false),
    [notice, setNotice] = useState("");
  const domain = taxonomy.domains.find((x) => x.id === value.domain),
    category = taxonomy.categories.find(
      (x) => x.id === value.categoryId && x.parent_id === value.domain,
    );
  const options = taxonomy.categories.filter(
    (x) => x.parent_id === value.domain,
  );
  return (
    <div className="classification-fields">
      <Field>
        {domainLabel}
        <Choice
          value={value.domain || ""}
          onChange={(e) =>
            onChange({ domain: e.target.value, categoryId: "", category: "" })
          }
        >
          <option value="">选择资料库</option>
          {!domain && value.domain && (
            <option value={value.domain}>资料库已失效，请重选</option>
          )}
          {taxonomy.domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Choice>
      </Field>
      <Field>
        {categoryLabel}
        <Choice
          value={value.categoryId || ""}
          onChange={(e) =>
            onChange({
              categoryId: e.target.value,
              category:
                taxonomy.categories.find((c) => c.id === e.target.value)
                  ?.name || "",
            })
          }
        >
          <option value="">选择分类</option>
          {!category && value.categoryId && (
            <option value={value.categoryId}>分类已失效或移动，请重选</option>
          )}
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Choice>
      </Field>
      {taxonomyError && <ErrorBox>{taxonomyError}</ErrorBox>}
      <div className="taxonomy-field-note">
        <Button type="button" variant="ghost" onClick={() => setRequest(true)}>
          找不到分类？申请新增
        </Button>
        <AppLink to="/requests" target="_blank">
          我的申请
        </AppLink>
        {notice && <span role="status">{notice}</span>}
      </div>
      {request && (
        <RequestDialog
          initial={{ kind: "category", parentId: value.domain }}
          onClose={() => setRequest(false)}
          onSuccess={() => setNotice("申请已提交，审核通过后可选择。")}
        />
      )}
      {(!domain || !category) && (
        <div className="taxonomy-field-note">
          <span>
            {!taxonomy.revision
              ? "正在读取选项…"
              : !options.length
                ? "当前资料库尚无分类，请先添加或选择其他资料库。"
                : "请选择有效的资料库与分类。"}
          </span>
          <Button type="button" variant="ghost" onClick={refreshTaxonomy}>
            刷新选项
          </Button>
          {user.role === "admin" && (
            <AppLink to="/admin/taxonomy" target="_blank">
              管理分类
            </AppLink>
          )}
        </div>
      )}
    </div>
  );
}
