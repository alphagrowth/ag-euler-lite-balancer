<script setup lang="ts">
import * as echarts from 'echarts'
import { ethers } from 'ethers'
import { INTEREST_RATE_MODEL_TYPE } from '~/entities/constants'
import type { Vault } from '~/entities/vault'
import { getVaultUtilization } from '~/entities/vault'
import { eulerVaultLensABI } from '~/entities/euler/abis'

const { vault } = defineProps<{ vault: Vault }>()

const chartRef = ref<HTMLDivElement | null>(null)
const chartInstance = ref<echarts.ECharts | null>(null)
const isLoading = ref(true)
const hasError = ref(false)

// Theme detection
const theme = useLocalStorage('theme', 'light')
const isDark = computed(() => theme.value === 'dark')

// Theme-aware colors
const chartColors = computed(() => isDark.value ? {
  text: '#a3a3a3',
  textMuted: '#737373',
  gridLine: '#262626',
  axisLine: '#404040',
  tooltip: {
    bg: 'rgba(26, 26, 26, 0.95)',
    border: '#404040',
    text: '#fafafa',
    textMuted: '#a3a3a3',
  },
  currentLine: '#a3a3a3',
} : {
  text: '#737373',
  textMuted: '#525252',
  gridLine: '#f5f5f5',
  axisLine: '#e5e5e5',
  tooltip: {
    bg: 'rgba(255, 255, 255, 0.95)',
    border: '#e5e5e5',
    text: '#262626',
    textMuted: '#525252',
  },
  currentLine: '#262626',
})

const { EVM_PROVIDER_URL } = useEulerConfig()
const { eulerLensAddresses } = useEulerAddresses()

// Check if IRM is valid (not zero address)
const hasValidIRM = computed(() => {
  return vault.interestRateModelAddress
    && vault.interestRateModelAddress !== '0x0000000000000000000000000000000000000000'
})

const irmTypeLabel = computed(() => {
  const modelType = Number(vault.irmInfo?.interestRateModelInfo?.interestRateModelType)
  if (modelType === INTEREST_RATE_MODEL_TYPE.KINK) {
    return 'Kink'
  }
  else if (modelType === INTEREST_RATE_MODEL_TYPE.ADAPTIVE_CURVE) {
    return 'Adaptive'
  }
  return 'Interest Rate Model'
})

// Generate cash and borrows data points for chart (0-100% utilization)
const generateChartDataPoints = () => {
  const amountPoints = 100
  const borrowsData: bigint[] = [BigInt(0)]

  for (let i = 1; i <= amountPoints; i += 1) {
    const borrow: bigint = BigInt(Math.floor((i / amountPoints) * 2 ** 32))
    borrowsData.push(borrow)
  }

  const cashData = [...borrowsData]
  cashData.reverse()

  return { cashData, borrowsData }
}

// Parse APY from bigint (27 decimals) to percentage number
const parseAPY = (apy: bigint): number => {
  return Number(ethers.formatUnits(apy, 27)) * 100
}

// Fetch interest rate model data
const fetchIRMData = async () => {
  if (!eulerLensAddresses.value?.vaultLens) {
    return null
  }

  try {
    const provider = new ethers.JsonRpcProvider(EVM_PROVIDER_URL)
    const vaultLensContract = new ethers.Contract(
      eulerLensAddresses.value.vaultLens,
      eulerVaultLensABI,
      provider,
    )

    const { cashData, borrowsData } = generateChartDataPoints()

    // Fetch general interest rate model info
    const irmData = await vaultLensContract.getVaultInterestRateModelInfo(
      vault.address,
      cashData,
      borrowsData,
    )

    let kinkData = null
    const modelType = Number(irmData.interestRateModelInfo?.interestRateModelType)

    // Fetch kink-specific data if applicable
    if (modelType === INTEREST_RATE_MODEL_TYPE.KINK) {
      try {
        kinkData = await vaultLensContract.getVaultKinkInterestRateModelInfo(vault.address)
      }
      catch (e) {
        console.warn('Failed to fetch kink IRM data:', e)
      }
    }

    return {
      irmData,
      kinkData,
    }
  }
  catch (error) {
    console.error('Failed to fetch IRM data:', error)
    return null
  }
}

// Initialize and render chart
const renderChart = async () => {
  if (!chartRef.value || !hasValidIRM.value) return

  isLoading.value = true
  hasError.value = false

  try {
    const data = await fetchIRMData()

    if (!data || !data.irmData?.interestRateInfo) {
      hasError.value = true
      isLoading.value = false
      return
    }

    const { irmData, kinkData } = data

    // Prepare chart data
    const borrowAPYData: [number, number][] = []
    const supplyAPYData: [number, number][] = []

    irmData.interestRateInfo.forEach((rate: { borrowAPY: bigint, supplyAPY: bigint }, i: number) => {
      borrowAPYData.push([i, parseAPY(rate.borrowAPY)])
      supplyAPYData.push([i, parseAPY(rate.supplyAPY)])
    })

    // Current utilization
    const currentUtilization = getVaultUtilization(vault)

    // Mark lines for vertical indicators
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markLines: any[] = [
      {
        name: 'Current',
        xAxis: currentUtilization,
        label: {
          formatter: `Current (${currentUtilization.toFixed(2)}%)`,
          position: 'insideEndTop',
          color: chartColors.value.currentLine,
          fontWeight: 500,
          fontSize: 11,
        },
        lineStyle: {
          color: chartColors.value.currentLine,
          type: 'dashed' as const,
          width: 1.5,
        },
      },
    ]

    // Add kink line if available
    if (kinkData?.interestRateInfo && kinkData.interestRateInfo.length > 1) {
      const kinkInfo = kinkData.interestRateInfo[1]
      const kinkCash = kinkData.interestRateInfo[0]?.cash || 0n
      const kinkBorrows = kinkInfo?.borrows || 0n

      if (kinkCash > 0n) {
        // Kink utilization is calculated as borrows / cash (not borrows / (cash + borrows))
        const kinkUtilization = Number((kinkBorrows * 10000n) / kinkCash) / 100

        markLines.push({
          name: 'Kink',
          xAxis: kinkUtilization,
          label: {
            formatter: `Kink (${kinkUtilization.toFixed(2)}%)`,
            position: 'insideStartTop',
            color: '#059669',
            fontWeight: 500,
            fontSize: 11,
          },
          lineStyle: {
            color: '#059669',
            type: 'dashed' as const,
            width: 1.5,
          },
        })
      }
    }

    // Initialize or get chart instance
    if (!chartInstance.value) {
      chartInstance.value = echarts.init(chartRef.value, undefined, {
        renderer: 'canvas',
      })
    }

    const option: echarts.EChartsOption = {
      animation: true,
      backgroundColor: 'transparent',
      grid: {
        left: '60px',
        right: '20px',
        top: '40px',
        bottom: '50px',
        containLabel: false,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        confine: true,
        backgroundColor: chartColors.value.tooltip.bg,
        borderColor: chartColors.value.tooltip.border,
        borderWidth: 1,
        textStyle: {
          color: chartColors.value.tooltip.text,
          fontSize: 13,
        },
        extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 8px;',
        axisPointer: {
          type: 'cross',
          axis: 'x',
          lineStyle: {
            color: chartColors.value.text,
            type: 'dashed',
            width: 1,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any): string => {
          if (!Array.isArray(params) || params.length === 0) {
            return ''
          }

          // Get utilization from x-axis value, rounded to nearest integer
          const utilization = Math.round(params[0].axisValue)

          // Find the closest data point for accurate APY values
          const borrowSeries = params.find((p: { seriesName: string }) => p.seriesName === 'Borrow APY')
          const supplySeries = params.find((p: { seriesName: string }) => p.seriesName === 'Supply APY')

          if (!borrowSeries || !supplySeries) {
            return ''
          }

          const borrowAPY = borrowSeries.value[1]
          const supplyAPY = supplySeries.value[1]
          const colors = chartColors.value

          return `
            <div style="padding: 4px 0;">
              <div style="margin-bottom: 8px; font-weight: 600; color: ${colors.tooltip.text};">
                Utilization: ${utilization}%
              </div>
              <div style="margin-bottom: 6px; display: flex; align-items: center;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#059669;margin-right:8px;"></span>
                <span style="color: ${colors.tooltip.textMuted};">Borrow APY:</span>
                <span style="margin-left: 4px; font-weight: 500;">${borrowAPY.toFixed(2)}%</span>
              </div>
              <div style="display: flex; align-items: center;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c49b64;margin-right:8px;"></span>
                <span style="color: ${colors.tooltip.textMuted};">Supply APY:</span>
                <span style="margin-left: 4px; font-weight: 500;">${supplyAPY.toFixed(2)}%</span>
              </div>
            </div>
          `
        },
      },
      xAxis: {
        type: 'value',
        name: 'Utilization %',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: {
          color: chartColors.value.text,
          fontSize: 12,
          fontWeight: 500,
        },
        min: 0,
        max: 100,
        interval: 10,
        axisLabel: {
          formatter: '{value}%',
          color: chartColors.value.text,
          fontSize: 11,
        },
        axisLine: {
          lineStyle: {
            color: chartColors.value.axisLine,
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: chartColors.value.gridLine,
          },
        },
      },
      yAxis: {
        type: 'value',
        name: 'APY %',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: {
          color: chartColors.value.text,
          fontSize: 12,
          fontWeight: 500,
        },
        axisLabel: {
          formatter: '{value}%',
          color: chartColors.value.text,
          fontSize: 11,
        },
        axisLine: {
          lineStyle: {
            color: chartColors.value.axisLine,
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: chartColors.value.gridLine,
          },
        },
      },
      series: [
        {
          name: 'Borrow APY',
          type: 'line',
          data: borrowAPYData,
          smooth: true,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            color: '#059669',
            width: 2.5,
          },
          itemStyle: {
            color: '#059669',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(5, 150, 105, 0.15)' },
                { offset: 1, color: 'rgba(5, 150, 105, 0)' },
              ],
            },
          },
          emphasis: {
            focus: 'series',
            lineStyle: {
              width: 3,
            },
          },
          markLine: {
            symbol: 'none',
            animation: false,
            silent: true,
            data: markLines,
          },
        },
        {
          name: 'Supply APY',
          type: 'line',
          data: supplyAPYData,
          smooth: true,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            color: '#c49b64',
            width: 2.5,
          },
          itemStyle: {
            color: '#c49b64',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(196, 155, 100, 0.15)' },
                { offset: 1, color: 'rgba(196, 155, 100, 0)' },
              ],
            },
          },
          emphasis: {
            focus: 'series',
            lineStyle: {
              width: 3,
            },
          },
        },
      ],
    }

    chartInstance.value?.setOption(option, {
      notMerge: true,
      lazyUpdate: false,
    })
  }
  catch (error) {
    console.error('Failed to render chart:', error)
    hasError.value = true
  }
  finally {
    isLoading.value = false
  }
}

const handleResize = () => {
  window.removeEventListener('resize', handleResize)
  chartInstance.value?.dispose()
  chartInstance.value = null
  setTimeout(() => {
    renderChart()
    window.addEventListener('resize', handleResize)
  }, 1000)
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance.value?.dispose()
})

onMounted(async () => {
  if (hasValidIRM.value) {
    await nextTick()
    await renderChart()
    window.addEventListener('resize', handleResize)
  }
})

// Re-render chart when theme changes
watch(theme, async () => {
  if (chartInstance.value && hasValidIRM.value) {
    chartInstance.value.dispose()
    chartInstance.value = null
    await nextTick()
    await renderChart()
  }
})
</script>

<template>
  <div
    v-if="hasValidIRM"
    class="bg-surface-secondary rounded-xl flex flex-col gap-16 p-24 shadow-card"
  >
    <div class="flex justify-between items-center flex-wrap gap-12">
      <div class="flex items-center gap-8">
        <p class="text-h3 text-content-primary">
          Interest rate model
        </p>
        <div class="inline-flex items-center py-0 px-4 rounded-4 bg-accent-300/30 text-accent-700 text-[12px] font-medium capitalize">
          {{ irmTypeLabel }}
        </div>
      </div>
    </div>

    <div class="relative w-full min-h-400">
      <div
        v-if="isLoading"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#888] text-center pointer-events-none"
      >
        Loading chart...
      </div>
      <div
        v-else-if="hasError"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#e15241] text-center pointer-events-none"
      >
        Failed to load interest rate data
      </div>
      <div
        ref="chartRef"
        class="w-full h-[400px]"
      />
    </div>
  </div>
</template>
