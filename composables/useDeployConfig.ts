export const useDeployConfig = () => {
  const rc = useRuntimeConfig().public
  const envConfig = useEnvConfig()

  const isEnabled = (val: unknown) => {
    const s = String(val)
    return s !== 'false' && s !== '0'
  }

  return {
    // URLs (empty string = not configured, hide UI element)
    docsUrl: rc.configDocsUrl,
    tosUrl: rc.configTosUrl || 'https://www.euler.finance/terms',
    tosMdUrl: rc.configTosMdUrl,
    xUrl: rc.configXUrl,
    discordUrl: rc.configDiscordUrl,
    telegramUrl: rc.configTelegramUrl,
    githubUrl: rc.configGithubUrl,

    // Branding (from useEnvConfig, not runtimeConfig)
    appTitle: envConfig.appTitle,
    appDescription: envConfig.appDescription,

    // Repos
    labelsRepo: rc.configLabelsRepo || 'euler-xyz/euler-labels',
    oracleChecksRepo: rc.configOracleChecksRepo || 'euler-xyz/oracle-checks',
    isCustomLabelsRepo: computed(() => (rc.configLabelsRepo || 'euler-xyz/euler-labels') !== 'euler-xyz/euler-labels'),

    // Feature flags: all enabled by default, set env var to 'false' to disable
    enableTosSignature: !!rc.configTosMdUrl,
    enableEntityBranding: isEnabled(rc.configEnableEntityBranding),
    enableVaultType: isEnabled(rc.configEnableVaultType),
    enableEarnPage: isEnabled(rc.configEnableEarnPage),
    enableLendPage: isEnabled(rc.configEnableLendPage),

    // Chains (derived from env vars at runtime via useChainConfig)
    ...useChainConfig(),
  }
}
