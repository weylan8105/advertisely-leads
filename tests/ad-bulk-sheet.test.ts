import { describe, it, expect } from "vitest";
import { parseAdSheet, adSheetTemplate, mediaTypeFor, driveFileId, driveDownloadUrl } from "@/lib/adBulkSheet";

// Pure unit tests for the Ad Bulk Uploader sheet parser — no network, no Meta.

const HEADER =
  "campaign_name,objective,adset_name,daily_budget,destination,lead_form_id,states,age_min,age_max,ad_name,media,primary_text,headline,cta,link_url";
const opts = { financialCategory: false, uploadedFiles: new Set(["a.jpg", "b.png"]) };

function sheet(...rows: string[]) {
  return [HEADER, ...rows].join("\n");
}

describe("parseAdSheet", () => {
  it("groups rows into campaigns, ad sets and ads", () => {
    const r = parseAdSheet(
      sheet(
        "Camp,LEADS,Set 1,50,FORM,111,FL;tx,30,60,Ad 1,a.jpg,Copy one,Head,SIGN_UP,",
        "Camp,,Set 1,,,,,,,Ad 2,b.png,Copy two,,,",
        "Camp,,Set 2,$25,FORM,222,,,,Ad 3,https://cdn.example.com/v.mp4?x=1,Copy three,,,",
      ),
      opts,
    );
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.campaigns).toHaveLength(1);
    expect(r.adsetCount).toBe(2);
    expect(r.adCount).toBe(3);
    const [s1, s2] = r.campaigns[0].adsets;
    expect(s1.dailyBudgetCents).toBe(5000);
    expect(s1.states).toEqual(["FL", "TX"]);
    expect(s1.ads.map((a) => a.name)).toEqual(["Ad 1", "Ad 2"]);
    expect(s1.ads[1].cta).toBe("LEARN_MORE");
    expect(s2.dailyBudgetCents).toBe(2500);
    expect(s2.states).toEqual([]);
    expect(s2.ads[0]).toMatchObject({ mediaType: "video", mediaIsUrl: true });
  });

  it("reports missing required columns", () => {
    const r = parseAdSheet("campaign_name,ad_name\nA,B", opts);
    expect(r.campaigns).toEqual([]);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/adset_name/);
  });

  it("flags row-level problems with their sheet row number", () => {
    const r = parseAdSheet(
      sheet(
        "Camp,LEADS,Set,50,FORM,,,,,Ad,a.jpg,Copy,,,",          // no form id
        "Camp,LEADS,Set B,50,WEBSITE,,,,,Ad,missing.jpg,Copy,,,", // missing file + no link_url
        "Camp,LEADS,Set C,abc,FORM,1,ZZ,,,Ad,a.jpg,Copy,,NOPE,",  // bad budget, state, cta
      ),
      opts,
    );
    const byRow = (row: number) => r.issues.filter((i) => i.row === row && i.level === "error").map((i) => i.message).join(" | ");
    expect(byRow(2)).toMatch(/lead_form_id is required/);
    expect(byRow(3)).toMatch(/hasn't been added/);
    expect(byRow(3)).toMatch(/link_url is required/);
    expect(byRow(4)).toMatch(/daily_budget/);
    expect(byRow(4)).toMatch(/Unknown state "ZZ"/);
    expect(byRow(4)).toMatch(/cta "NOPE"/);
    expect(r.adCount).toBe(0);
  });

  it("rejects contradictions inside one ad set", () => {
    const r = parseAdSheet(
      sheet(
        "Camp,LEADS,Set,50,FORM,111,,,,Ad 1,a.jpg,Copy,,,",
        "Camp,LEADS,Set,75,FORM,111,,,,Ad 2,a.jpg,Copy,,,",
      ),
      opts,
    );
    expect(r.issues.find((i) => i.row === 3)?.message).toMatch(/daily_budget differs from row 2/);
    expect(r.adCount).toBe(1);
  });

  it("locks ages to 18–65 under the Financial products category", () => {
    const r = parseAdSheet(sheet("Camp,LEADS,Set,50,FORM,111,,35,55,Ad,a.jpg,Copy,,,"), {
      ...opts,
      financialCategory: true,
    });
    expect(r.campaigns[0].adsets[0]).toMatchObject({ ageMin: 18, ageMax: 65 });
    expect(r.issues.some((i) => i.level === "warning" && /Financial/.test(i.message))).toBe(true);
  });

  it("refuses local video files and TRAFFIC + FORM", () => {
    const r = parseAdSheet(
      sheet(
        "Camp,LEADS,Set,50,FORM,111,,,,Ad,clip.mp4,Copy,,,",
        "T,TRAFFIC,Set,50,FORM,111,,,,Ad,a.jpg,Copy,,,https://x.com",
      ),
      opts,
    );
    expect(r.issues.find((i) => i.row === 2)?.message).toMatch(/must be an https:\/\/ link/);
    expect(r.issues.find((i) => i.row === 3)?.message).toMatch(/TRAFFIC campaigns can't use an instant form/);
  });

  it("parses its own template without errors (files unchecked)", () => {
    const r = parseAdSheet(adSheetTemplate(), { financialCategory: false, uploadedFiles: null });
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.adCount).toBe(2);
  });
});

describe("Google Drive links", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  const DIRECT = `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`;

  it("finds the file ID in every Drive link shape", () => {
    expect(driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(ID);
    expect(driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=drive_link`)).toBe(ID);
    expect(driveFileId(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(driveFileId(`https://drive.google.com/uc?export=download&id=${ID}`)).toBe(ID);
    expect(driveFileId(`https://docs.google.com/uc?id=${ID}`)).toBe(ID);
    expect(driveFileId(DIRECT)).toBe(ID);
    expect(driveFileId(`https://drive.google.com/drive/folders/${ID}`)).toBeNull();
    expect(driveFileId("https://cdn.example.com/file/d/abc/view")).toBeNull();
    expect(driveFileId("a.jpg")).toBeNull();
  });

  it("swaps share links for the direct download and treats them as video unless told otherwise", () => {
    const H = `${HEADER},media_type`;
    const r = parseAdSheet(
      [
        H,
        `Camp,LEADS,Set,50,FORM,111,,,,Ad 1,https://drive.google.com/file/d/${ID}/view?usp=sharing,Copy,,,,`,
        `Camp,LEADS,Set,50,FORM,111,,,,Ad 2,https://drive.google.com/open?id=${ID}x,Copy,,,,image`,
        `Camp,LEADS,Set,50,FORM,111,,,,Ad 3,https://drive.google.com/drive/folders/${ID},Copy,,,,`,
      ].join("\n"),
      opts,
    );
    const ads = r.campaigns[0].adsets[0].ads;
    expect(ads[0]).toMatchObject({ media: DIRECT, mediaType: "video", mediaIsUrl: true });
    expect(ads[1]).toMatchObject({ media: driveDownloadUrl(`${ID}x`), mediaType: "image", mediaIsUrl: true });
    expect(r.issues.find((i) => i.row === 4)?.message).toMatch(/isn't a Drive file link/);
    expect(r.adCount).toBe(2);
  });
});

describe("mediaTypeFor", () => {
  it("uses the extension, ignoring query strings, unless media_type is set", () => {
    expect(mediaTypeFor("https://x.com/a.MP4?dl=1", "")).toBe("video");
    expect(mediaTypeFor("photo.jpeg", "")).toBe("image");
    expect(mediaTypeFor("https://drive.example.com/file/abc", "")).toBeNull();
    expect(mediaTypeFor("https://drive.example.com/file/abc", "Video")).toBe("video");
  });
});
