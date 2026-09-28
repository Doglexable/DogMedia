import { describe, expect, it } from "vitest";
import { cleanAssToVtt, probeSubtitleStreams, serializeSubtitle } from "./subtitles.js";

describe("cleanAssToVtt", () => {
  it("strips override blocks, multiline comments, and vector drawings", () => {
    const rawVtt = `WEBVTT

00:00.000 --> 00:04.000
EmotPekmen

00:01.540 --> 00:04.380
<b><i>Aku punya hawa keberadaan
yang rendah dari yang lainnya.</i>{I have less presence
than other people.}</b>

00:02.000 --> 00:15.170
<b>m 0 0 l 120 0 120 120.625 0 120.625</b>

00:15.170 --> 00:20.170
S{*\c&HFEFAF1&}M{*\c&HFEFAF0&}A{*\c&HFEFAEF&} Haruka Utara
`;

    const cleaned = cleanAssToVtt(rawVtt);

    expect(cleaned).toContain("00:01.540 --> 00:04.380");
    expect(cleaned).toContain("Aku punya hawa keberadaan\nyang rendah dari yang lainnya.");
    // Comment in {...} must be stripped
    expect(cleaned).not.toContain("I have less presence");
    // Vector drawing m 0 0 ... must be dropped
    expect(cleaned).not.toContain("m 0 0 l");
    // Inline override tags {*\c...} stripped
    expect(cleaned).toContain("SMA Haruka Utara");
  });

  it("handles empty or blank VTT cleanly", () => {
    expect(cleanAssToVtt("")).toBe("WEBVTT\n\n");
    expect(cleanAssToVtt(null)).toBe("WEBVTT\n\n");
  });
});

describe("probeSubtitleStreams", () => {
  it("parses ASS and SRT streams correctly with styling flags", async () => {
    const mockFfprobe = async () => ({
      stdout: JSON.stringify({
        streams: [
          {
            index: 0,
            codec_name: "ass",
            codec_type: "subtitle",
            disposition: { default: 1 },
            tags: { language: "ind", title: "Emot" },
          },
          {
            index: 2,
            codec_name: "subrip",
            codec_type: "subtitle",
            disposition: { default: 0 },
            tags: { language: "eng", title: "English" },
          },
        ],
      }),
    });

    const streams = await probeSubtitleStreams("video.mkv", mockFfprobe);

    expect(streams).toHaveLength(2);
    expect(streams[0]).toEqual({
      streamIndex: 0,
      codec: "ass",
      language: "ind",
      title: "Emot",
      isDefault: true,
      hasAssStyling: true,
      format: "ass",
    });
    expect(streams[1]).toEqual({
      streamIndex: 2,
      codec: "subrip",
      language: "eng",
      title: "English",
      isDefault: false,
      hasAssStyling: false,
      format: "srt",
    });
  });

  it("returns an empty array when no subtitle streams exist or probe fails", async () => {
    const failingProbe = async () => { throw new Error("ffprobe failed"); };
    await expect(probeSubtitleStreams("video.mp4", failingProbe)).resolves.toEqual([]);
  });
});

describe("serializeSubtitle", () => {
  it("formats subtitle endpoints and flags ASS styling", () => {
    const assRow = {
      id: 5,
      media_id: 114,
      stream_index: 0,
      language: "ind",
      title: "Emot",
      format: "ass",
      has_ass_styling: true,
      is_default: true,
    };

    const srtRow = {
      id: 6,
      media_id: 114,
      stream_index: 1,
      language: "eng",
      title: "English",
      format: "srt",
      has_ass_styling: false,
      is_default: false,
    };

    expect(serializeSubtitle(assRow)).toEqual({
      id: 5,
      mediaId: 114,
      streamIndex: 0,
      language: "ind",
      title: "Emot",
      format: "ass",
      hasAssStyling: true,
      isDefault: true,
      vttUrl: "/api/media/114/subtitles/5/vtt",
      assUrl: "/api/media/114/subtitles/5/ass",
    });

    expect(serializeSubtitle(srtRow)).toEqual({
      id: 6,
      mediaId: 114,
      streamIndex: 1,
      language: "eng",
      title: "English",
      format: "srt",
      hasAssStyling: false,
      isDefault: false,
      vttUrl: "/api/media/114/subtitles/6/vtt",
      assUrl: null,
    });
  });
});
