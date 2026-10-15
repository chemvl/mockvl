/**
 * storage
 * @type {*}
 * @description 各项目有一个命名空间，clear只能清空当前命名的value；storage存储的value将是一个序列化后的对象
 * */
const namespace: string = import.meta.env.VITE_APP_PROJECT_NAME
const storage = {
  getStorage() {
    return JSON.parse(window.localStorage.getItem(namespace) || '{}')
  },
  setItem(key: string, value: any) {
    const data = this.getStorage()
    data[key] = value
    window.localStorage.setItem(namespace, JSON.stringify(data))
  },
  getItem(key: string) {
    const data = this.getStorage()
    return data[key]
  },
  removeItem(key: string) {
    const data = this.getStorage()
    delete data[key]
    window.localStorage.setItem(namespace, JSON.stringify(data))
  },
  clear() {
    window.localStorage.removeItem(namespace)
  }
}

export default storage
