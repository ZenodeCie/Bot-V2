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

export const HUB_PREFIX = "cfg_"

export function isConfigHubCustomId(customId: string): boolean {
  return customId.startsWith(HUB_PREFIX)
}
