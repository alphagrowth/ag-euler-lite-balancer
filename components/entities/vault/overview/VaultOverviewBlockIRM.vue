<script setup lang="ts">
import * as echarts from 'echarts'
import { ethers } from 'ethers'
import type { Vault } from '~/entities/vault'
import { getVaultUtilization } from '~/entities/vault'
import { eulerVaultLensABI } from '~/entities/euler/abis'

const { vault } = defineProps<{ vault: Vault }>()

const chartRef = ref<HTMLDivElement | null>(null)
const chartInstance = ref<echarts.ECharts | null>(null)
const isLoading = ref(true)
const hasError = ref(false)

const { EVM_PROVIDER_URL } = useEulerConfig()
const { eulerLensAddresses } = useEulerAddresses()

// Check if IRM is valid (not zero address)
const hasValidIRM = computed(() => {
  return vault.interestRateModelAddress
    && vault.interestRateModelAddress !== '0x0000000000000000000000000000000000000000'
})

// Interest Rate Model Types
const INTEREST_RATE_MODEL_TYPE = {
  KINK: 1,
  ADAPTIVE_CURVE: 2,
}

const irmTypeLabel = computed(() => {
  const modelType = Number(vault.irmInfo?.interestRateModelInfo?.interestRateModelType)
  if (modelType === INTEREST_RATE_MODEL_TYPE.KINK) {
    return 'Kink'
  }
  else if (modelType === INTEREST_RATE_MODEL_TYPE.ADAPTIVE_CURVE) {
    return 'Adaptive Curve'
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
    if (modelType === INTEREST_RATE_MODEL_TYPE.KINK || modelType === INTEREST_RATE_MODEL_TYPE.ADAPTIVE_CURVE) {
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
        },
        lineStyle: {
          color: '#FFFFFF',
          type: 'dashed' as const,
          width: 1,
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
            color: '#23C09B',
          },
          lineStyle: {
            color: '#23C09B',
            type: 'dashed' as const,
            width: 1,
          },
        })
      }
    }

    // Initialize or get chart instance
    if (!chartInstance.value) {
      chartInstance.value = echarts.init(chartRef.value, 'dark', {
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
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        borderColor: '#333',
        borderWidth: 1,
        textStyle: {
          color: '#fff',
        },
        axisPointer: {
          type: 'cross',
          axis: 'x',
          lineStyle: {
            color: '#888',
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

          return `
            <div style="padding: 8px;">
              <div style="margin-bottom: 8px;">
                <strong>Utilization:</strong> ${utilization}%
              </div>
              <div style="margin-bottom: 4px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E15241;margin-right:5px;"></span>
                <strong>Borrow APY:</strong> ${borrowAPY.toFixed(2)}%
              </div>
              <div>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#23C09B;margin-right:5px;"></span>
                <strong>Supply APY:</strong> ${supplyAPY.toFixed(2)}%
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
          color: '#888',
          fontSize: 12,
        },
        min: 0,
        max: 100,
        interval: 10,
        axisLabel: {
          formatter: '{value}%',
          color: '#888',
        },
        axisLine: {
          lineStyle: {
            color: '#333',
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#222',
          },
        },
      },
      yAxis: {
        type: 'value',
        name: 'APY %',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: {
          color: '#888',
          fontSize: 12,
        },
        axisLabel: {
          formatter: '{value}%',
          color: '#888',
        },
        axisLine: {
          lineStyle: {
            color: '#333',
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#222',
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
            color: '#23C09B',
            width: 2,
          },
          itemStyle: {
            color: '#23C09B',
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
            color: '#f7772c',
            width: 2,
          },
          itemStyle: {
            color: '#f7772c',
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
</script>

<template>
  <div
    v-if="hasValidIRM"
    class="bg-euler-dark-300 br-16 column gap-16 p-24"
  >
    <div class="row justify-between align-center wrap gap-12">
      <div class="row align-center gap-8">
        <p class="h3 text-white">
          Interest rate model
        </p>
        <div :class="$style.chip">
          {{ irmTypeLabel }}
        </div>
      </div>
    </div>

    <div :class="$style.chartWrapper">
      <div
        v-if="isLoading"
        :class="$style.loading"
      >
        Loading chart...
      </div>
      <div
        v-else-if="hasError"
        :class="$style.error"
      >
        Failed to load interest rate data
      </div>
      <div
        ref="chartRef"
        :class="$style.chart"
      />
    </div>
  </div>
</template>

<style module lang="scss">
.chip {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  border-radius: 4px;
  background-color: var(--c-aquamarine-opaque-400);
  color: var(--c-aquamarine-700);
  font-size: 12px;
  font-weight: 500;
  text-transform: capitalize;
}

.chartWrapper {
  position: relative;
  width: 100%;
  min-height: 400px;
}

.chart {
  width: 100%;
  height: 400px;
}

.loading,
.error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #888;
  text-align: center;
  pointer-events: none;
}

.error {
  color: #e15241;
}
</style>
