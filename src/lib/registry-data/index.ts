import type { SkillMeta } from "../registry-types.js";
import { DEVELOPMENT_TOOLS_SKILLS } from "./development-tools.js";
import { BUSINESS_MARKETING_SKILLS } from "./business-marketing.js";
import { PRODUCTIVITY_ORGANIZATION_SKILLS } from "./productivity-organization.js";
import { PROJECT_MANAGEMENT_SKILLS } from "./project-management.js";
import { CONTENT_GENERATION_SKILLS } from "./content-generation.js";
import { FINANCE_COMPLIANCE_SKILLS } from "./finance-compliance.js";
import { DATA_ANALYSIS_SKILLS } from "./data-analysis.js";
import { MEDIA_PROCESSING_SKILLS } from "./media-processing.js";
import { DESIGN_BRANDING_SKILLS } from "./design-branding.js";
import { WEB_BROWSER_SKILLS } from "./web-browser.js";
import { RESEARCH_WRITING_SKILLS } from "./research-writing.js";
import { SCIENCE_ACADEMIC_SKILLS } from "./science-academic.js";
import { EDUCATION_LEARNING_SKILLS } from "./education-learning.js";
import { COMMUNICATION_SKILLS } from "./communication.js";
import { HEALTH_WELLNESS_SKILLS } from "./health-wellness.js";
import { TRAVEL_LIFESTYLE_SKILLS } from "./travel-lifestyle.js";
import { EVENT_MANAGEMENT_SKILLS } from "./event-management.js";

export const SKILLS: SkillMeta[] = [
  ...DEVELOPMENT_TOOLS_SKILLS,
  ...BUSINESS_MARKETING_SKILLS,
  ...PRODUCTIVITY_ORGANIZATION_SKILLS,
  ...PROJECT_MANAGEMENT_SKILLS,
  ...CONTENT_GENERATION_SKILLS,
  ...FINANCE_COMPLIANCE_SKILLS,
  ...DATA_ANALYSIS_SKILLS,
  ...MEDIA_PROCESSING_SKILLS,
  ...DESIGN_BRANDING_SKILLS,
  ...WEB_BROWSER_SKILLS,
  ...RESEARCH_WRITING_SKILLS,
  ...SCIENCE_ACADEMIC_SKILLS,
  ...EDUCATION_LEARNING_SKILLS,
  ...COMMUNICATION_SKILLS,
  ...HEALTH_WELLNESS_SKILLS,
  ...TRAVEL_LIFESTYLE_SKILLS,
  ...EVENT_MANAGEMENT_SKILLS,
];
