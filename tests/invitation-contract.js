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
  const invite = await create();
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
