export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务器响应异常，请重试" }));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    if (response.status === 401 && !url.startsWith("/auth"))
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  return data;
}
export const send = (url, body, method = "POST") =>
  api(url, { method, body: JSON.stringify(body) });
export function uploadResource(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/resources");
    xhr.upload.onprogress = (event) =>
      event.lengthComputable &&
      onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () =>
      reject(new Error("网络连接失败，文件已保留在表单中，请重试"));
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error("上传响应异常，请重试"));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        reject(new Error(data.error || "上传失败，请重试"));
      }
    };
    xhr.send(formData);
  });
}
export const size = (bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
export const date = (value) =>
  new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(
    new Date(value),
  );
export const fullDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
export function format(resource) {
  if (resource.kind === "link")
    return /github|git-scm/.test(resource.url)
      ? "CODE"
      : /bilibili|youtube/.test(resource.url)
        ? "VIDEO"
        : "LINK";
  const ext = resource.attachments[0]?.name.split(".").pop().toUpperCase();
  return ext || "FILE";
}
