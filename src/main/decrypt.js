import crypto from 'crypto'

// 固定密钥
const FIXED_KEY = 'HqQ1lktHBygmbnrQ'

// AES解密函数
function decrypt(data, key) {
  const keyBuffer = Buffer.from(key, 'utf8')
  const algorithm = 'aes-128-ecb'
  // ECB模式iv必须为null
  const decipher = crypto.createDecipheriv(algorithm, keyBuffer, null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

// 将字节数组转换为整数
function bytesToInt(bytes) {
  return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
}

// 解密PDF文件前一部分（与AESUtil.java中的decryptPartFile逻辑相同）
export function decryptPdf(pdfBuffer, fileKey) {
  try {
    const buffer = Buffer.from(pdfBuffer)
    // 读取前4个字节作为加密大小
    const sizeBytes = buffer.slice(0, 4)
    const encryptedSize = bytesToInt(sizeBytes)
    // 读取加密的数据
    const encrypted = buffer.slice(4, 4 + encryptedSize)
    // 读取剩余的数据
    const tail = buffer.slice(4 + encryptedSize)

    let decrypted

    // 第一次解密：使用传入的fileKey
    try {
      decrypted = decrypt(encrypted, fileKey)
    } catch (firstError) {
      console.log('使用fileKey解密失败，尝试使用固定密钥', firstError.message)

      // 第二次解密：使用固定密钥
      try {
        decrypted = decrypt(encrypted, FIXED_KEY)
      } catch (secondError) {
        console.error('两次解密均失败', secondError.message)
        throw new Error('PDF解密失败: 两次解密尝试均失败')
      }
    }

    // 组合解密后的数据和剩余数据
    return Buffer.concat([decrypted, tail])
  } catch (error) {
    console.error('PDF解密过程出错:', error)
    throw new Error('PDF解密失败: ' + error.message)
  }
}
