import {v2 as cloudinary} from "cloudinary"
import { Readable } from "stream"

cloudinary.config({
    cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
    api_key:process.env.CLOUDINARY_API_KEY,
    api_secret:process.env.CLOUDINARY_API_SECRET
})

/** Cap stored originals so phone dumps do not consume storage / bandwidth credits. */
const IMAGE_UPLOAD_TRANSFORMATION = [
  { width: 1600, crop: 'limit' as const, quality: 'auto:good' as const },
]

export type HandleUploadOptions = {
  /** When false, skip incoming resize (e.g. PDFs / raw files). Default true. */
  isImage?: boolean
}

export const handleUpload = async (
  fileBuffer: Buffer,
  options?: HandleUploadOptions,
) => {
  const isImage = options?.isImage !== false
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      isImage
        ? {
            transformation: IMAGE_UPLOAD_TRANSFORMATION,
            resource_type: 'image',
          }
        : { resource_type: 'auto' },
      (error, result) => {
        if (error) {
          return reject(error)
        }
        return resolve(result)
      },
    )

    Readable.from(fileBuffer).pipe(uploadStream)
  })
}

export default cloudinary
