export const CFG_MODULE_SELECT = "cfg_module_select"
export const CFG_AR_SELECT = "cfg_ar_select"
export const CFG_BACK = "cfg_back"
export const CFG_BACK_AR = "cfg_back:antiraid"
export const CFG_PREFIX_BTN = "cfg_prefix_btn"
export const CFG_PREFIX_MODAL = "cfg_prefix_modal"
export const CFG_ML_CHANNEL = "cfg_ml_channel"
export const CFG_ML_OFF = "cfg_ml_off"
export const CFG_BL_TOGGLE = "cfg_bl_toggle"
export const CFG_BL_PUNISH = "cfg_bl_punish"
export const CFG_BL_CHANNEL = "cfg_bl_channel"

export const CFG_PART_TOGGLE = "cfg_part_toggle"
export const CFG_PART_REVIEW_CHANNEL = "cfg_part_review_channel"
export const CFG_PART_ANNOUNCE_CHANNEL = "cfg_part_announce_channel"
export const CFG_PART_ROLE = "cfg_part_role"
export const CFG_PART_COOLDOWN_BTN = "cfg_part_cooldown_btn"
export const CFG_PART_COOLDOWN_MODAL = "cfg_part_cooldown_modal"
export const CFG_PART_MINMEMBERS_BTN = "cfg_part_minmembers_btn"
export const CFG_PART_MINMEMBERS_MODAL = "cfg_part_minmembers_modal"

export const HUB_PREFIX = "cfg_"

export function isConfigHubCustomId(customId: string): boolean {
  return customId.startsWith(HUB_PREFIX)
}
