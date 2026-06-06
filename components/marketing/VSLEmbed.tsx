import { PlayCircle } from "lucide-react";

interface VSLEmbedProps {
  /**
   * Drop your embed code here when the VSL is ready.
   * Examples:
   *   - YouTube iframe URL: "https://www.youtube.com/embed/VIDEO_ID"
   *   - Vimeo: "https://player.vimeo.com/video/VIDEO_ID"
   *   - Wistia: "https://fast.wistia.net/embed/iframe/VIDEO_ID"
   *   - VSLify / VidAlytics / VTurb: paste their iframe URL
   * Leave undefined to show the placeholder.
   */
  src?: string;
  title?: string;
  poster?: string;
}

export function VSLEmbed({ src, title, poster }: VSLEmbedProps) {
  if (!src) {
    return (
      <div className="relative aspect-video w-full rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-black overflow-hidden">
        {poster && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-50"
          />
        )}
        <div className="absolute inset-0 bg-grid-light opacity-10 pointer-events-none" />
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center max-w-md px-6">
            <div className="mx-auto mb-5 h-16 w-16 grid place-items-center rounded-full border border-brand-red/40 bg-brand-red/10">
              <PlayCircle className="h-8 w-8 text-brand-red" />
            </div>
            <div className="text-xs uppercase tracking-[0.22em] text-brand-red font-semibold mb-2">
              Video coming soon
            </div>
            <p className="text-sm text-white/60">
              {title ??
                "Hear the full story behind Advertisely Leads — why we built it, who it's for, and what makes our IUL leads different."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full rounded-2xl border border-white/10 bg-black overflow-hidden">
      <iframe
        src={src}
        title={title ?? "Advertisely Leads"}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
