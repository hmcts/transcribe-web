import type {
  AdminJurisdiction,
  DocumentContent,
} from "@/lib/editor-contracts";

export const IAC_NAME = "First-tier Tribunal Immigration and Asylum Chamber";

export const IAC_CONTENT: DocumentContent = {
  jurisdiction: { id: "iac", name: IAC_NAME },
  has_legal_wording: true,
  hearing_types: [
    {
      id: "face_to_face",
      title: "Face to face",
      hearing_title: "Face to face hearing",
      hearing_description: "Heard in person.",
    },
  ],
  legal_frameworks: [
    {
      id: "credibility",
      title: "Credibility",
      rank: 1,
      content: "Credibility framework text.",
      issues: ["Is the appellant credible?"],
    },
  ],
  anonymity: {
    statuses: [
      {
        id: "granted",
        title: "Granted",
        content: "An order was made.",
        identifier: "Yes",
        header: "Anonymity order",
        order_header: "Anonymity order made",
        order_text: "Do not identify the appellant.",
      },
    ],
  },
};

// A jurisdiction whose wording has no legal frameworks.
export const TAX_CONTENT: DocumentContent = {
  jurisdiction: { id: "tax", name: "Tax Tribunal" },
  has_legal_wording: false,
  hearing_types: [
    {
      id: "tax_hearing",
      title: "Tax hearing",
      hearing_title: "Tax hearing",
      hearing_description: "A tax hearing.",
    },
  ],
  legal_frameworks: [],
  anonymity: IAC_CONTENT.anonymity,
};

export const IAC_ADMIN_JURISDICTION: AdminJurisdiction = {
  id: "iac",
  name: IAC_NAME,
  has_legal_wording: true,
  can_edit: true,
};

export const TAX_ADMIN_JURISDICTION: AdminJurisdiction = {
  id: "tax",
  name: "Tax Tribunal",
  has_legal_wording: false,
  can_edit: true,
};
