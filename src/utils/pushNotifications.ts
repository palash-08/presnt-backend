import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo();

/**
 * Send a push notification via Expo's push service.
 * This is the same mechanism the app used before (calling Expo's API directly),
 * but now from the server instead of the client.
 */
export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
): Promise<void> {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.warn(`Invalid Expo push token: ${expoPushToken}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

/**
 * Send push notifications to multiple tokens in batch.
 */
export async function sendPushNotificationsBatch(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, any> = {}
): Promise<void> {
  const messages: ExpoPushMessage[] = tokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: 'default' as const,
      title,
      body,
      data,
    }));

  if (messages.length === 0) return;

  // Expo recommends chunking for large batches
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error('Error sending push notification chunk:', error);
    }
  }
}
