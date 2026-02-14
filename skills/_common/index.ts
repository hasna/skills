/**
 * Shared SDK for skills
 *
 * Common utilities used across skill-audio, skill-browse, skill-codefix,
 * skill-convert, skill-deploy, skill-extract, skill-image, skill-transcript,
 * skill-video, and skill-write.
 */

export { checkSkillAuth, isRemoteExecution, requireAuthIfRemote } from './auth';
export {
  executeSkill,
  saveBlob,
  executeAndSave,
  type SkillRequest,
  type SkillResponse,
} from './http-client';
export {
  SkillInstaller,
  runInstaller,
  type SkillConfig,
  type AssistantType,
} from './installer';
export { handleInstallCommand } from './skill-install';
