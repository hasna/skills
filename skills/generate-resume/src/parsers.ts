import { readFile } from "node:fs/promises";

import type { Certification, Education, Experience, Language, Project, ResumeData, Skill } from "./types";

export function parseExperience(data: string[]): Experience[] {
  return data.map((item) => {
    const [title, company, dates, description] = item.split("|");
    return { title, company, dates, description };
  });
}

export function parseEducation(data: string[]): Education[] {
  return data.map((item) => {
    const [degree, school, dates, details] = item.split("|");
    return { degree, school, dates, details };
  });
}

export function parseSkills(data: string[]): Skill[] {
  return data.map((item) => {
    const [name, levelStr] = item.split("|");
    const level = parseInt(levelStr) || 3;
    return { name, level };
  });
}

export function parseProjects(data: string[]): Project[] {
  return data.map((item) => {
    const [name, description, url] = item.split("|");
    return { name, description, url };
  });
}

export function parseCertifications(data: string[]): Certification[] {
  return data.map((item) => {
    const [name, year, issuer] = item.split("|");
    return { name, year, issuer };
  });
}

export function parseLanguages(data: string[]): Language[] {
  return data.map((item) => {
    const [name, proficiency] = item.split("|");
    return { name, proficiency };
  });
}

// Import from LinkedIn JSON
export async function importFromLinkedIn(filePath: string): Promise<Partial<ResumeData>> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Parse LinkedIn profile data
    // Note: LinkedIn export format may vary, this is a simplified parser
    return {
      name: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : undefined,
      title: data.headline,
      location: data.location?.name,
      summary: data.summary,
      experience: data.positions?.values?.map((pos: any) => ({
        title: pos.title,
        company: pos.company?.name,
        dates: `${pos.startDate?.month || ""}/${pos.startDate?.year || ""}-${
          pos.isCurrent ? "Present" : `${pos.endDate?.month || ""}/${pos.endDate?.year || ""}`
        }`,
        description: pos.summary || "",
      })) || [],
      education: data.educations?.values?.map((edu: any) => ({
        degree: edu.degree || edu.fieldOfStudy,
        school: edu.schoolName,
        dates: `${edu.startDate?.year || ""}-${edu.endDate?.year || ""}`,
        details: edu.notes,
      })) || [],
      skills: data.skills?.values?.map((skill: any, index: number) => ({
        name: skill.name,
        level: Math.min(5, Math.max(1, Math.floor(skill.endorsementCount / 10) + 3)),
      })) || [],
      certifications: data.certifications?.values?.map((cert: any) => ({
        name: cert.name,
        year: cert.startDate?.year?.toString() || "",
        issuer: cert.authority,
      })) || [],
      languages: data.languages?.values?.map((lang: any) => ({
        name: lang.name,
        proficiency: lang.proficiency?.name || "Professional",
      })) || [],
    };
  } catch (error) {
    console.error("Error parsing LinkedIn data:", error);
    return {};
  }
}

// Generate HTML resume
