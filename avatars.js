const fs = require('node:fs/promises');
const sharp = require('sharp');

const AVATARS_DIR = 'data/avatars';
const AVATARS_PUBLIC_PATH = '/avatars';
const AVATAR_SIZE = 256;
const JPEG_QUALITY = 85;

async function downloadFile(fileUrl) {
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function saveTelegramAvatar(ctx, fileId) {
  const fileUrl = await ctx.telegram.getFileLink(fileId);
  const imageBuffer = await downloadFile(fileUrl);
  const fileName = `telegram_${ctx.from.id}.jpg`;
  const filePath = `${AVATARS_DIR}/${fileName}`;

  await fs.mkdir(AVATARS_DIR, { recursive: true });
  await sharp(imageBuffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(filePath);

  return `${AVATARS_PUBLIC_PATH}/${fileName}`;
}

async function getUserAvatarPath(ctx) {
  let avatarPath = '';
  const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);

  if (photos.total_count) {
    const photoSizes = photos.photos[0];
    const largestPhoto = photoSizes[photoSizes.length - 1];
    avatarPath = await saveTelegramAvatar(ctx, largestPhoto.file_id);
  }

  return avatarPath;
}

module.exports = {
  getUserAvatarPath,
};
