import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../context";
import { Field, Choice, Loading, ErrorBox, Empty } from "../components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function MemberList() {
  const { user } = useApp();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/members")
      .then((r) => {
        if (active) setMembers(r.members);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  const query = search.trim().toLocaleLowerCase();
  const filtered = members.filter(
    (member) =>
      (!role || member.role === role) &&
      (!query ||
        member.name.toLocaleLowerCase().includes(query) ||
        member.email.toLocaleLowerCase().includes(query)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * 20, current * 20);
  return (
    <section className="member-directory" aria-label="成员列表">
      <h2>成员列表</h2>
      {loading ? (
        <Loading text="正在加载成员…" />
      ) : error ? (
        <>
          <ErrorBox>{error}</ErrorBox>
          <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
            重新加载成员
          </Button>
        </>
      ) : (
        <>
          <p className="member-count" aria-live="polite">
            共 {members.length} 位成员 · 当前匹配 {filtered.length} 位
          </p>
          <div className="member-filters">
            <Field>
              搜索成员
              <Input
                placeholder="输入姓名或邮箱"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field>
              角色
              <Choice
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部角色</option>
                <option value="admin">管理员</option>
                <option value="member">普通成员</option>
              </Choice>
            </Field>
          </div>
          {rows.length ? (
            <>
              <Table className="member-table" aria-label="队伍成员">
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <span>{member.name}</span>
                        {member.id === user.id && (
                          <Badge variant="outline">当前账号</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {member.email.split("@")[0]}
                        <wbr />@{member.email.split("@").slice(1).join("@")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {member.role === "admin" ? "管理员" : "普通成员"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <nav className="member-pagination" aria-label="成员分页">
                <Button
                  variant="outline"
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  上一页
                </Button>
                <span aria-live="polite">
                  第 {current} / {pages} 页
                </span>
                <Button
                  variant="outline"
                  disabled={current === pages}
                  onClick={() => setPage(current + 1)}
                >
                  下一页
                </Button>
              </nav>
            </>
          ) : (
            <Empty
              title={members.length ? "没有找到匹配的成员" : "暂无成员"}
              description={
                members.length
                  ? "试试其他姓名、邮箱或角色。"
                  : "成员加入后会显示在这里。"
              }
            />
          )}
        </>
      )}
    </section>
  );
}
