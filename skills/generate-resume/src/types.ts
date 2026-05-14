export interface Experience {
  title: string;
  company: string;
  dates: string;
  description: string;
}

export interface Education {
  degree: string;
  school: string;
  dates: string;
  details?: string;
}

export interface Skill {
  name: string;
  level: number;
}

export interface Project {
  name: string;
  description: string;
  url?: string;
}

export interface Certification {
  name: string;
  year: string;
  issuer?: string;
}

export interface Language {
  name: string;
  proficiency: string;
}

export interface ResumeData {
  // Contact
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  twitter?: string;
  photo?: string;

  // Professional
  title?: string;
  summary?: string;

  // Sections
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
  certifications: Certification[];
  languages: Language[];

  // Design
  template: string;
  layout: string;
  color: string;
  font: string;
  fontSize: string;
  spacing: string;
  atsFriendly: boolean;
  includePhoto: boolean;
  pageNumbers: boolean;
}

export interface CoverLetterData {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  company: string;
  position: string;
  content: string;
  template: string;
  date: string;
}

// Parse command line arguments
