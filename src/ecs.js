// 羽量級 ECS 與 Object Pool 實作 (符合 .antigravityrules 規範)

export class World {
    constructor() {
        this.nextEntityId = 1;
        this.entities = new Set();
        this.components = new Map(); // componentName -> Map(entityId -> data)
        this.entitiesToDestroy = new Set();
    }

    spawn() {
        const id = this.nextEntityId++;
        this.entities.add(id);
        return id;
    }

    destroy(entity) {
        this.entitiesToDestroy.add(entity); // 延遲刪除
    }

    flush() {
        for (const entity of this.entitiesToDestroy) {
            this.entities.delete(entity);
            for (const map of this.components.values()) {
                map.delete(entity);
            }
        }
        this.entitiesToDestroy.clear();
    }

    addComponent(entity, name, data) {
        if (!this.components.has(name)) {
            this.components.set(name, new Map());
        }
        this.components.get(name).set(entity, data);
    }

    getComponent(entity, name) {
        return this.components.get(name)?.get(entity);
    }

    hasComponent(entity, name) {
        return this.components.get(name)?.has(entity) || false;
    }

    getEntries(name) {
        return this.components.get(name)?.entries() || [];
    }
}

export class ObjectPool {
    constructor(factory, initialSize) {
        this.factory = factory;
        this.pool = [];
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
        }
    }

    acquire() {
        return this.pool.length > 0 ? this.pool.pop() : this.factory();
    }

    release(obj) {
        this.pool.push(obj);
    }
}
