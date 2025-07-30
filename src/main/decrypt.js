import crypto from 'crypto'

// AES解密函数
function decrypt(data, key) {
  // key = 'HqQ1lktHBygmbnrQ'
  const keyBuffer = Buffer.from(key, 'utf8')
  // const keyHash = crypto.createHash('md5').update(keyBuffer).digest()
  const algorithm = 'aes-128-ecb'
  // ECB模式iv必须为null
  const decipher = crypto.createDecipheriv(algorithm, keyBuffer, null)
  decipher.setAutoPadding(true)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted
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
    // 解密数据
    console.log(encryptedSize, fileKey)
    const decrypted = decrypt(encrypted, fileKey)
    // 组合解密后的数据和剩余数据
    const result = Buffer.concat([decrypted, tail])
    return result
  } catch (error) {
    console.error('PDF解密失败:', error)
    throw new Error('PDF解密失败: ' + error.message)
  }
}