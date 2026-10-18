import { Checkbox } from "@/components/ui/checkbox";
import { useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { get } from "@/lib/api";
import { type Artifact, mediaURL } from "@/lib/types";
import { Loading, ErrorBox, Status } from "./shared";
export function MediaPlayer({ asset: a }: { asset: Artifact }) {
  const audio = useRef<HTMLAudioElement>(null),
    [start, setStart] = useState("0"),
    [end, setEnd] = useState("8"),
    [zoom, setZoom] = useState(false);
  const wave = useQuery({
    queryKey: ["waveform", a.id],
    queryFn: ({ signal }) =>
      get<{
        peaks: number[];
        duration_seconds: number;
        sampled_seconds: number;
        truncated: boolean;
      }>("waveform", { id: a.id }, signal),
    enabled: a.media_type === "audio",
    staleTime: Infinity,
    retry: false,
  });
  if (a.media_type === "image")
    return (
      <div className={"image-viewer " + (zoom ? "zoomed" : "")}>
        <Button
          variant="outline"
          className="zoom-button"
          onClick={() => setZoom(!zoom)}
        >
          {zoom ? "适应画面" : "原尺寸查看"}
        </Button>
        <img src={mediaURL(a)} alt={a.relative_path} />
      </div>
    );
  if (a.media_type === "video")
    return (
      <video
        controls
        preload="metadata"
        src={mediaURL(a)}
        className="media-video"
      />
    );
  return (
    <div className="audio-viewer">
      <audio
        ref={audio}
        controls
        preload="metadata"
        src={mediaURL(a)}
        onTimeUpdate={() => {
          if (
            audio.current &&
            audio.current.dataset.end &&
            audio.current.currentTime >= Number(audio.current.dataset.end)
          ) {
            audio.current.pause();
            delete audio.current.dataset.end;
          }
        }}
      />
      {wave.data && (
        <>
          <svg
            viewBox="0 0 720 100"
            aria-label="真实音频振幅波形"
            role="img"
            onClick={(e) => {
              if (audio.current) {
                const r = e.currentTarget.getBoundingClientRect();
                audio.current.currentTime =
                  ((e.clientX - r.left) / r.width) * wave.data.sampled_seconds;
              }
            }}
          >
            {wave.data.peaks.map((v, i) => (
              <line
                key={i}
                x1={(i * 720) / wave.data.peaks.length}
                x2={(i * 720) / wave.data.peaks.length}
                y1={50 - v * 48}
                y2={50 + v * 48}
                stroke="currentColor"
                strokeWidth="3"
              />
            ))}
          </svg>
          <p className="subtle">
            点击波形跳转{wave.data.truncated ? " · 波形仅显示前10分钟" : ""}
          </p>
        </>
      )}
      {wave.error && (
        <p className="subtle">波形暂不可用：{wave.error.message}</p>
      )}
      <div className="form-grid">
        <div>
          <Label htmlFor="audition-start">起始秒</Label>
          <Input
            id="audition-start"
            type="number"
            min="0"
            step="0.01"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="audition-end">结束秒</Label>
          <Input
            id="audition-end"
            type="number"
            min="0"
            step="0.01"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <Button
        variant="outline"
        disabled={!(Number(end) > Number(start) && Number(start) >= 0)}
        onClick={() => {
          if (audio.current) {
            audio.current.currentTime = Number(start);
            audio.current.dataset.end = end;
            void audio.current.play().catch(() => {});
          }
        }}
      >
        试听所选区间
      </Button>
    </div>
  );
}
export function CompareDialog({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const a = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["artifact", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        get<Artifact>("artifact", { id }, signal),
    })),
  });
  const players = useRef<(HTMLMediaElement | null)[]>([]);
  const [sync, setSync] = useState(true);
  const data = a.map((q) => q.data).filter((x): x is Artifact => !!x);
  const same = data.length === 2 && data[0].media_type === data[1].media_type;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="compare-dialog sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>版本对比</DialogTitle>
          <DialogDescription>
            比较不会改变选用；确认后再决定本篇使用哪一版。
          </DialogDescription>
        </DialogHeader>
        {a.some((q) => q.isPending) ? (
          <Loading />
        ) : a.some((q) => q.error) ? (
          <ErrorBox error={a.find((q) => q.error)?.error || null} />
        ) : !same ? (
          <p>请选择两个相同媒体类型的素材。</p>
        ) : (
          <>
            <label className="check-label">
              <Checkbox
                checked={sync}
                onCheckedChange={(checked) => setSync(checked === true)}
              />
              声音或视频从同一时间点对比；也可关闭后分别定位
            </label>
            <div className="compare-grid">
              {data.map((asset, i) => (
                <section key={asset.id}>
                  <h3>
                    {i ? "B" : "A"} · {asset.relative_path.split("/").pop()}
                  </h3>
                  {asset.media_type === "image" ? (
                    <img src={mediaURL(asset)} alt={asset.relative_path} />
                  ) : asset.media_type === "audio" ? (
                    <audio
                      ref={(p) => {
                        players.current[i] = p;
                      }}
                      controls
                      src={mediaURL(asset)}
                      onPlay={() => {
                        const other = players.current[1 - i],
                          p = players.current[i];
                        if (other && p) {
                          if (sync) p.currentTime = other.currentTime;
                          other.pause();
                        }
                      }}
                    />
                  ) : (
                    <video
                      ref={(p) => {
                        players.current[i] = p;
                      }}
                      controls
                      src={mediaURL(asset)}
                      onPlay={() => {
                        const other = players.current[1 - i],
                          p = players.current[i];
                        if (other && p) {
                          if (sync) p.currentTime = other.currentTime;
                          other.pause();
                        }
                      }}
                    />
                  )}
                  <Status value={asset.status} />
                </section>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
