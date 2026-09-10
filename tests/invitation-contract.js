import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Run the same observable registration contract against Express and Workers.
export async function invitationContract(request, adminCookie, insert) {
  const account = {
    name: "邀请码测试",
    email: "code-contract@example.test",
    password: "Invitation-test-12345",
  };
  const register = (token, fields = {}) =>
    request("/auth/register", {
      method: "POST",
      cookie: null,
      body: { ...account, ...fields, token },
    });
  const create = async () => {
    const result = await request("/invitations", {
      method: "POST",
      cookie: adminCookie,
      body: {},
    });
    assert.equal(result.status, 201);
    assert.match(result.data.token, /^[0-9A-HJKMNP-TV-Z]{12}$/);
    assert.ok(Math.abs(result.data.expires - Date.now() - 7 * 86400000) < 5000);
    return result.data;
  };
  const erase = (id, cookie = adminCookie) =>
    request("/invitations/" + id + "/record", { method: "DELETE", cookie });
  const invite = await create();
  assert.equal((await erase(invite.id)).status, 409);
  assert.equal((await erase("does-not-exist")).status, 404);
  assert.equal((await request("/members", { cookie: null })).status, 401);
  assert.equal((await erase(invite.id, null)).status, 401);
  for (const token of [undefined, "", "   ", "INVALID-CODE"])
    assert.equal((await register(token)).status, 410);
  assert.equal(
    (await register(invite.token, { password: "short" })).status,
    400,
  );
  assert.equal(
    (await register(invite.token, { email: "admin@example.test" })).status,
    409,
  );
  const normalized = "  " + invite.token.toLowerCase() + "  ";
  assert.equal(
    (await request("/auth/invitation/" + encodeURIComponent(normalized)))
      .status,
    200,
  );
  const registered = await register(normalized);
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  assert.ok(registered.cookie);
  assert.equal(registered.data.user.role, "member");
  assert.equal(
    (await request("/members", { cookie: registered.cookie })).status,
    403,
  );
  assert.equal((await erase(invite.id, registered.cookie)).status, 403);
  const initialMembers = (await request("/members", { cookie: adminCookie }))
    .data.members;
  for (let i = 0; i < 23; i++)
    await insert(
      "INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)",
      "directory-" + i,
      "目录队员 " + i,
      "directory-" + i + "@example.test",
      "not-a-login-password",
      "member",
    );
  const directory = await request("/members", { cookie: adminCookie });
  assert.equal(directory.status, 200);
  assert.equal(directory.data.members.length, initialMembers.length + 23);
  assert.equal(
    new Set(directory.data.members.map((m) => m.id)).size,
    directory.data.members.length,
  );
  for (const m of directory.data.members)
    assert.deepEqual(Object.keys(m).sort(), ["email", "id", "name", "role"]);
  assert.ok(
    directory.data.members.some((m) => m.id === registered.data.user.id),
  );
  assert.ok(
    directory.data.members.some(
      (m) => m.email === "admin@example.test" && m.role === "admin",
    ),
  );
  const beforeResources = await request("/resources", {
    cookie: registered.cookie,
  });
  assert.equal(beforeResources.status, 200);
  assert.equal((await erase(invite.id)).status, 200);
  assert.equal((await erase(invite.id)).status, 404);
  assert.ok(
    !(
      await request("/invitations", { cookie: adminCookie })
    ).data.invitations.some((i) => i.id === invite.id),
  );
  const afterResources = await request("/resources", {
    cookie: registered.cookie,
  });
  assert.equal(afterResources.status, 200);
  assert.deepEqual(
    afterResources.data.resources,
    beforeResources.data.resources,
  );
  assert.equal(
    (await request("/members", { cookie: adminCookie })).data.members.length,
    directory.data.members.length,
  );
  assert.equal(
    (await request("/me", { cookie: registered.cookie })).data.user.email,
    account.email,
  );
  assert.equal(
    (await register(invite.token, { email: "reuse@example.test" })).status,
    410,
  );
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        cookie: registered.cookie,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/me", { cookie: registered.cookie })).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        cookie: null,
        body: account,
      })
    ).status,
    200,
  );
  const revoked = await create();
  await request("/invitations/" + revoked.id, {
    method: "DELETE",
    cookie: adminCookie,
  });
  assert.equal(
    (await register(revoked.token, { email: "revoked@example.test" })).status,
    410,
  );
  assert.equal((await erase(revoked.id)).status, 200);
  assert.equal(
    (await request("/auth/invitation/" + revoked.token)).status,
    410,
  );
  const seed = async (id, token, expires) =>
    insert(
      "INSERT INTO invitations(id,token_hash,created_by,expires) VALUES(?,?,?,?)",
      id,
      createHash("sha256").update(token).digest("hex"),
      "test-admin",
      expires,
    );
  await seed("expired-contract", "23456789ABCD", Date.now() - 1000);
  assert.equal(
    (await register("23456789ABCD", { email: "expired@example.test" })).status,
    410,
  );
  assert.equal((await erase("expired-contract")).status, 200);
  assert.equal((await request("/auth/invitation/23456789ABCD")).status, 410);
  const legacy = "abcdef0123456789".repeat(3);
  await seed("legacy-contract", legacy, Date.now() + 86400000);
  assert.equal(
    (await request("/auth/invitation/" + legacy.toUpperCase())).status,
    200,
  );
  assert.equal(
    (
      await register(" " + legacy.toUpperCase() + " ", {
        email: "legacy-contract@example.test",
      })
    ).status,
    201,
  );
  assert.equal(
    (await register(legacy, { email: "legacy-reuse@example.test" })).status,
    410,
  );
}
