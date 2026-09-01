import { describe, expect, it } from "vitest";
import {
  redactPiiText,
  redactSectionedTranscript,
} from "@/lib/transcript-redaction";

describe("transcript redaction", () => {
  it("redacts supported placeholder tags", () => {
    expect(redactPiiText("Witness: <name>")).toBe("Witness: [NAME REDACTED]");
    expect(redactPiiText("Witness: &lt;name&gt;")).toBe(
      "Witness: [NAME REDACTED]"
    );
    expect(redactPiiText("Contact <email> or <phone>")).toBe(
      "Contact [EMAIL REDACTED] or [PHONE REDACTED]"
    );
    expect(redactPiiText("Lives at <address> and postcode <postcode>")).toBe(
      "Lives at [ADDRESS REDACTED] and postcode [POSTCODE REDACTED]"
    );
    expect(redactPiiText("DOB: <dob>, NI: <ni number>")).toBe(
      "DOB: [DATE OF BIRTH REDACTED], NI: [NI NUMBER REDACTED]"
    );
  });

  it("redacts structured direct PII patterns", () => {
    expect(
      redactPiiText(
        "Email john.smith@example.com, phone 07123 456789, NI AA 12 34 56 C."
      )
    ).toBe(
      "Email [EMAIL REDACTED], phone [PHONE REDACTED], NI [NI NUMBER REDACTED]."
    );
    expect(
      redactPiiText(
        "DOB: 01/02/2003, Date of birth: 1 January 2003, Postcode: SW1A 1AA"
      )
    ).toBe(
      "DOB: [DATE OF BIRTH REDACTED], Date of birth: [DATE OF BIRTH REDACTED], Postcode: [POSTCODE REDACTED]"
    );
    expect(
      redactPiiText(
        "Sarah Williams appearing on behalf of the appellant from 12 Acacia Road, London SW1A 1AA."
      )
    ).toBe(
      "[NAME REDACTED] appearing on behalf of the appellant from [ADDRESS REDACTED]."
    );
    expect(
      redactPiiText(
        "This is the appeal hearing in the case of Smith versus the Secretary of State. Mr Patel appears today."
      )
    ).toBe(
      "This is the appeal hearing in the case of [NAME REDACTED] versus the Secretary of State. [NAME REDACTED] appears today."
    );
  });

  it("redacts speaker names and transcript text without mutating timestamps", () => {
    const transcript = {
      background: [
        {
          speaker: "Sarah Williams",
          text: "My name is Sarah Williams and please email me at person@example.com",
          timestamp: "10:00",
          timestampMs: 600000,
        },
      ],
      evidence: [],
      facts: [],
    };

    expect(redactSectionedTranscript(transcript)).toEqual({
      background: [
        {
          speaker: "[NAME REDACTED]",
          text: "My name is [NAME REDACTED] and please email me at [EMAIL REDACTED]",
          timestamp: "10:00",
          timestampMs: 600000,
        },
      ],
      evidence: [],
      facts: [],
    });
    expect(transcript.background[0]?.speaker).toBe("Sarah Williams");
  });

  it("redacts the appellant name throughout the transcript when provided as context", () => {
    const transcript = {
      background: [
        {
          speaker: "Emily",
          text: "Emily confirmed that Emily's bundle was complete.",
          timestamp: "10:00",
        },
      ],
      evidence: [],
      facts: [],
    };

    expect(
      redactSectionedTranscript(transcript, { appellantName: "Emily" })
    ).toEqual({
      background: [
        {
          speaker: "[NAME REDACTED]",
          text: "[NAME REDACTED] confirmed that [NAME REDACTED]'s bundle was complete.",
          timestamp: "10:00",
        },
      ],
      evidence: [],
      facts: [],
    });
  });

  it("redacts appellant-linked dob and address details in realistic transcript prose", () => {
    const transcript = {
      background: [
        {
          speaker: "Judge",
          text: "Emily was born on 1 January 1990 and lives at Flat 2, 12 Acacia Road, London SW1A 1AA.",
          timestamp: "10:00",
        },
        {
          speaker: "Counsel",
          text: "The appellant's postcode is SW1A 1AA and her NI number is AA 12 34 56 C.",
          timestamp: "10:01",
        },
      ],
      evidence: [],
      facts: [],
    };

    expect(
      redactSectionedTranscript(transcript, { appellantName: "Emily" })
    ).toEqual({
      background: [
        {
          speaker: "Judge",
          text: "[NAME REDACTED] was born on [DATE OF BIRTH REDACTED] and lives at [ADDRESS REDACTED].",
          timestamp: "10:00",
        },
        {
          speaker: "Counsel",
          text: "The appellant's postcode is [POSTCODE REDACTED] and her NI number is [NI NUMBER REDACTED].",
          timestamp: "10:01",
        },
      ],
      evidence: [],
      facts: [],
    });
  });
});
