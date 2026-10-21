# Video links, body previews, and playback

These rules cover local recordings, YouTube, and Bilibili. Choose presentation by editorial role, not provider. Follow the article's JQ theme; do not build a separate player skin or attempt to restyle cross-origin player internals.

## Decide whether the video is a reference or body content

**Reference-only video:** use an ordinary `href` with a descriptive title, provider, and author/speaker when known. An existing References citation is sufficient. A short reading recommendation may accompany it. Do not generate thumbnails, large cards, reserved player space, iframes, or another duplicate video gallery. This applies to reference links in prose as well as the final References section. Opening the source is the action; no player or thumbnail request is needed.

**Body video:** use a preview when the video itself explains the nearby mechanism, demonstrates behavior, or supplies evidence the argument discusses. Show a genuine cover/poster, original title, provider/source link, and one or two sentences explaining what the reader will see and why it matters. If discussing a particular segment, include a verified timestamp. Do not insert a body embed merely to satisfy a media quota.

The unplayed preview should be compact: a small thumbnail beside the title and summary is preferred over an empty full-width cinema rectangle. Use one accessible play/expand action. Only allocate the full player area when activated. Do not hide all context behind a collapsed text label; the cover and summary should already help the reader decide whether to watch. A small-screen layout must remain readable without reverting to an oversized decorative card.

Do not relocate a reference video into the body just to retain its embed. Apply the same role decision to YouTube, Bilibili, and other providers. Supporting a policy in this skill is not proof that the current renderer implements every provider.

## Sources and covers

- Preserve original titles, creators, and source URLs. Do not invent duration, subtitles, dates, thumbnails, or transcript content.
- Prefer an authorized original cover or an actual frame from a local recording. Label a diagram poster or title card accurately. Never present generated imagery as a source-video screenshot.
- If a cover cannot be obtained legitimately, use a clearly labeled compact title fallback with the real source link. Report the missing cover instead of claiming a verified poster preview.
- Do not recolor reference covers to gold or crop meaningful text. Keep source-language material intact; the English-only diagram rule applies to authored technical diagrams/UI, not to rewriting cited footage or official covers.
- Authored technical video labels, nodes, legends, and demonstration UI use English; surrounding explanations follow the article language. Provide accurate captions and a text summary for authored speech. Label silent recordings explicitly and explain the mechanism in adjacent prose or a static figure.
- A recording proves only the recorded interaction. An illustrative merge flow is not live CI or production telemetry.

## Layout and CSS

Use the selected theme's canvas, surface, ink, muted, gold, and hairline tokens and article typography. Prefer restrained separators, moderate spacing, and minimal Lucide controls; avoid heavy cards, glow, gradients, hover zoom, glass effects, and carousels.

- Collapsed body preview: approximately 96-160px thumbnail width depending on available space; preserve its source ratio. Text and actions must fit at 320/390px. This is a layout guideline, not a fixed height requirement for every video.
- Expanded player: no wider than the reading column; reserve the actual aspect ratio. Use `object-fit: contain`, not cropping that hides demonstration content. Preserve portrait/screen-recording proportions.
- Apply the provider's actual player-size requirements only to the activated player, not to reference links or compact thumbnails. YouTube's minimum player viewport is 200 by 200px; recheck current provider requirements when implementing an integration.
- Keep captions, sources, close actions, and error messages outside the player. Do not cover controls or subtitles. Touch targets are at least 44px, with visible keyboard focus and accessible names.
- After explicit expansion, keep loading/player/error geometry stable. Collapsing returns to the compact preview. A failure retains a useful source link and retry/close path.
- Print: omit players and controls; retain the title, summary, and source URL. No JavaScript: reference links work normally; body previews retain the cover, summary, and source, with native video controls or a usable disclosure where applicable.

Use the local preview's `.body-video`, `.media-card`, `.media-stage`, and `.media-native` styles as examples, not a second theme to copy wholesale.

## Loading and playback

For local video, use `<video controls playsinline preload="none" poster="...">`, or `metadata` only when justified. Provide MIME types and download/static alternatives. Confirm browser codec support; do not put large videos into Git by default.

For body YouTube or Bilibili videos, start with the compact cover and summary. Create the provider iframe only after activation. Use the platform's current supported embed format and validate the actual video identity and selected part/segment. Verify Bilibili-specific embed behavior against the source page or official player guidance rather than copying YouTube parameters. Keep a canonical video-page `href` regardless of embed availability. Do not invent a Bilibili sample or replace an unavailable source with an unrelated video.

YouTube's privacy-enhanced endpoint is `https://www.youtube-nocookie.com/embed/VIDEO_ID`; preserve native controls, keyboard access, fullscreen, and `autoplay=0`. Avoid deprecated parameters such as `modestbranding`. For any provider, do not assume its default autoplay behavior is safe: explicitly disable it where supported and verify the actual result. If reliable embedding is unavailable, use the compact cover linked to the source and report the limitation.

Give iframes meaningful titles, fullscreen support, minimal necessary permissions, and an appropriate referrer policy. Do not delay a request again with lazy loading after the reader has activated it. Allow only the actually used provider hosts in the target deployment's CSP. Link-only references do not justify a `frame-src` exception. Do not add wildcards or `unsafe-inline` for an embed. Preview over HTTP(S).

Closing destroys an iframe or pauses native video and restores focus to its trigger. Switching media stops the prior player. No autoplay does not mean zero third-party traffic after activation; privacy-enhanced embedding is not a no-data guarantee.

An iframe `load` event is not evidence that playback works. Region, login, source-side embedding restrictions, or network errors can appear inside an otherwise loaded iframe. Retain source and retry/close options without bypassing those restrictions.

## Preview and verification

1. Inventory reference-only and body videos. References must remain ordinary links with no poster/player footprint. Body previews must expose a cover, title, content summary, and source before playback.
2. Deliver a real preview URL and source location. Inspect desktop and 320/390px layouts, including long titles, poster failures, focus, and expanded player geometry. Capture actual screenshots.
3. Verify no third-party player request before activation; close/collapse stops playback and switching leaves one active player. Inspect console/CSP/404 errors. Playback verification requires media decoding and advancing time, not iframe presence.
4. Check no-JS, reduced-motion, print, and failure fallbacks. If a provider is blocked, report layout/fallback verification separately from unverified playback. Do not claim Bilibili playback was tested when only the policy was added.
5. Local preview, verified playback, Vercel Preview, and Production publication are distinct outcomes.

## References

- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters): viewport, parameters, keyboard controls, and autoplay.
- [Embed videos and playlists](https://support.google.com/youtube/answer/171780?hl=en): privacy-enhanced embedding and source settings.
- [YouTube embedded player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality): client identity and referrer requirements; removing identity is not a fix for errors such as 153.

Visual style comes from the user's JQ preference. Technical provider requirements are separate from branding. Use [interactive visuals](interactive-visuals.md) for the broader editorial examples.
