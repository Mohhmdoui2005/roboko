import crypto from 'crypto'

export interface RobotTestPayload {
  domain: 'ROBOT_TEST'
  robot_id: string
}

export interface PersonLunchPayload {
  domain: 'PERSON_LUNCH'
  user_id: string
  sig: string
}

export type QRScanPayload = RobotTestPayload | PersonLunchPayload

export function generateRobotPayload(robotId: string): string {
  return JSON.stringify({
    domain: 'ROBOT_TEST',
    robot_id: robotId,
  })
}

export function generatePersonLunchPayload(userId: string, secretKey: string): string {
  const baseData = {
    domain: 'PERSON_LUNCH',
    user_id: userId,
  }
  const serialized = JSON.stringify(baseData)
  const hmac = crypto.createHmac('sha256', secretKey)
  hmac.update(serialized)
  const sig = hmac.digest('hex')

  return JSON.stringify({
    ...baseData,
    sig,
  })
}

export function parseQRScanPayload(rawScannedString: string): QRScanPayload | null {
  try {
    const data = JSON.parse(rawScannedString)
    if (!data || typeof data !== 'object') return null

    if (data.domain === 'ROBOT_TEST' && typeof data.robot_id === 'string') {
      return data as RobotTestPayload
    }

    if (data.domain === 'PERSON_LUNCH' && typeof data.user_id === 'string' && typeof data.sig === 'string') {
      return data as PersonLunchPayload
    }

    return null
  } catch {
    return null
  }
}

export async function processScannedCode(
  rawScannedString: string,
  handlers: {
    onRobotTest: (robotId: string) => Promise<{ success: boolean; message?: string }>
    onPersonLunch: (payload: PersonLunchPayload) => Promise<{ success: boolean; message?: string }>
  }
): Promise<{ success: boolean; domain?: string; message?: string }> {
  const parsed = parseQRScanPayload(rawScannedString)
  if (!parsed) {
    return { success: false, message: 'Invalid or unrecognized QR code format.' }
  }

  if (parsed.domain === 'ROBOT_TEST') {
    const res = await handlers.onRobotTest(parsed.robot_id)
    return { success: res.success, domain: 'ROBOT_TEST', message: res.message }
  }

  if (parsed.domain === 'PERSON_LUNCH') {
    const res = await handlers.onPersonLunch(parsed)
    return { success: res.success, domain: 'PERSON_LUNCH', message: res.message }
  }

  return { success: false, message: 'Unsupported domain payload.' }
}
