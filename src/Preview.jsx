import React, { useState, useEffect } from "react";
import { Download, FileText, AlertCircle } from "lucide-react";
import { size } from "./api";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";

export default function Preview({ attachments }) {
  const [index, setIndex] = useState(0),
    [failed, setFailed] = useState(false),
    [text, setText] = useState(""),
    [loading, setLoading] = useState(false);
  const file = attachments[index];
  useEffect(() => {
    setFailed(false);
    setText("");
    if (file?.mime === "text/plain") {
      let alive = true;
      setLoading(true);
      fetch(`/api/files/${file.id}?preview=1`)
        .then((r) => {
          if (!r.ok) throw Error();
          return r.text();
        })
        .then((t) => {
          if (alive) setText(t);
        })
        .catch(() => {
          if (alive) setFailed(true);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }
  }, [file?.id]);
  if (!file)
    return (
      <div className="file-fallback">
        <AlertCircle size={30} />
        <h2>暂时没有可用附件</h2>
        <p>请联系贡献者补充文件。</p>
      </div>
    );
  const url = `/api/files/${file.id}?preview=1`;
  const image = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ].includes(file.mime),
    pdf = file.mime === "application/pdf";
  return (
    <>
      {attachments.length > 1 && (
        <div className="preview-tabs">
          {attachments.map((a, i) => (
            <Button
              variant={i === index ? "secondary" : "ghost"}
              aria-pressed={i === index}
              key={a.id}
              onClick={() => setIndex(i)}
            >
              {a.name}
            </Button>
          ))}
        </div>
      )}
      {failed ? (
        <div className="file-fallback">
          <AlertCircle size={28} />
          <h2>预览暂时不可用</h2>
          <p>可以下载原文件，或联系贡献者检查附件。</p>
        </div>
      ) : image ? (
        <div className="image-preview">
          <img src={url} alt={file.name} onError={() => setFailed(true)} />
        </div>
      ) : pdf ? (
        <div className="pdf-preview">
          <iframe
            src={url}
            title={`PDF 预览：${file.name}`}
            onError={() => setFailed(true)}
          />
          <Button variant="ghost" onClick={() => setFailed(true)}>
            预览无法显示？
          </Button>
        </div>
      ) : file.mime === "text/plain" ? (
        <div className="text-preview">
          {loading ? (
            <Skeleton className="h-8 w-full" aria-label="正在加载预览" />
          ) : (
            <pre>{text}</pre>
          )}
        </div>
      ) : (
        <div className="file-fallback">
          <div className="file-illustration">
            <FileText size={46} strokeWidth={1} />
          </div>
          <h2>{file.name}</h2>
          <p>此格式暂不支持在线预览，请下载后查看。</p>
          <span>{size(file.size)}</span>
        </div>
      )}
      <div className="preview-bottom">
        <span>{file.name}</span>
        <Button variant="outline" asChild>
          <a href={`/api/files/${file.id}`} download>
            <Download size={15} />
            下载原文件
          </a>
        </Button>
      </div>
    </>
  );
}
