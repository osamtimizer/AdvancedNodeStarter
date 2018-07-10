const mongoose = require('mongoose');
const redis = require('redis');
const util = require('util');
const redisUrl = 'redis://127.0.0.1:6379';
const client = redis.createClient(redisUrl);
client.hget = util.promisify(client.hget);

const exec = mongoose.Query.prototype.exec;

mongoose.Query.prototype.cache = function(options = {}) {
    //this === このクエリオブジェクト
    //このメソッドを呼ぶことで、利用側からキャッシュのON/OFFを指定できる
    this.useCache = true;
    //自分自身を返すことでchainable functionとなる

    //top level keyを指定する
    //this.hashKeyにすることでオブジェクト内で参照可能になる。
    this.hashKey = JSON.stringify(options.key || '');

    return this;
}

mongoose.Query.prototype.exec = async function () {
    if(!this.useCache){
        return exec.apply(this, arguments);
    }
    //this keyword will Query object instance itself.
    //In case of exec func, this object will be a user found by Query.

    //Objectのコピーを作る
    //this.getQueryは現在のクエリをjsonで取得できる
    const key = JSON.stringify(Object.assign({}, this.getQuery(), {
        collection: this.mongooseCollection.name
    }));

    // See if we have a value for 'key' in redis
    const cacheValue = await client.hget(this.hashKey, key);

    // If we do, return that
    if(cacheValue) {
        const doc = JSON.parse(cacheValue);

        return Array.isArray(doc)
        ? doc.map(d => new this.model(d))
        : new this.model(doc);
    }

    // Otherwise, issue the query and store the result in redis
    //execメソッドで返ってくるのはDocumentオブジェクト
    const result = await exec.apply(this, arguments);

    //redisに保存する
    //durationを引数に取れる
    //'EX'が必要
    client.hset(this.hashKey, key, JSON.stringify(result), 'EX', 10);

    return result;

};

module.exports = {
    clearHash(hashKey) {
        client.del(JSON.stringify(hashKey));
    }
};

