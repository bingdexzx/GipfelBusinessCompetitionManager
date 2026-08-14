import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

export default class Store {
  private data: Record<string, any> = {}
  private filePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, 'config.json')
    this.load()
  }

  private load() {
    try {
      if (existsSync(this.filePath)) {
        this.data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      this.data = {}
    }
  }

  private save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch {}
  }

  get(key: string): any {
    return this.data[key]
  }

  set(key: string, value: any) {
    this.data[key] = value
    this.save()
  }

  getAll(): Record<string, any> {
    return { ...this.data }
  }
}
