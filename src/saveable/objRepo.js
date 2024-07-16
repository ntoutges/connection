export class ObjRepo {
    objects = new Map();
    addObject(param1, param2, param3 = null, param4 = null) {
        let category;
        let name;
        let object;
        let params;
        if (typeof param2 == "string") { // single class
            category = param1;
            name = param2;
            object = param3;
            params = param4 ?? null;
        }
        else if (param1.includes("::")) { // explicit class name
            [category, name] = param1.split("::");
            object = param2;
            params = param3;
        }
        else { // implicit class name
            category = param1;
            name = param2.name;
            object = param2;
            params = param3;
        }
        if (!this.objects.has(category))
            this.objects.set(category, new Map());
        this.objects.get(category).set(name, { classname: object, params });
    }
    removeObject(category, name) {
        return this.objects.get(category)?.delete(name);
    }
    getObject(param1, param2 = null, param3 = null) {
        let category;
        let name;
        let fallback;
        if (param2 == null) {
            [category, name] = param1.split("::");
            fallback = param2;
        }
        else
            [category, name, fallback] = [param1, param2, param3];
        const data = this.objects.get(category)?.get(name);
        return {
            classname: data?.classname ?? fallback,
            params: data?.params ?? null
        };
    }
}
//# sourceMappingURL=objRepo.js.map