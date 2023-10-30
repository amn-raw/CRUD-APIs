const express = require('express');
const app = express();
const amqp  = require('amqplib');
const mongoose = require('mongoose');
const User = require('./models/userModel');
const redis = require('redis');
const router = express.Router();
const fs = require('fs');
const { Client } = require('@elastic/elasticsearch');
const { type } = require('os');
const { match } = require('assert');


const elasticClient  = new Client({
    node:'https://localhost:9200',
    auth:{
        username:"elastic",
        password:"rc8BECPzWDpEHFCL7ea5"
    },
    tls:{
        ca: fs.readFileSync('./http_ca.crt'),
        rejectUnauthorized:false
    }
});

const uriCloud = 'mongodb+srv://yourUsername:yourPasswordcrud.mic3rkp.mongodb.net/third?retryWrites=true&w=majority' ; //encode your password in pct encoding

const uriLocal = 'mongodb://localhost:27017/users';

const redisClient = redis.createClient(6379,'127.0.0.1');

//connecting with redis through redisClient
redisClient.connect();
redisClient.on("connect",()=>{
    console.log('connected to redis.');
})

//connecting with mongoDB
const connection = mongoose.connect(uriLocal)
  .then((res)=>{
        console.log('connected to mongoDB Local')
        app.listen(PORT,()=>{
            console.log('Server is listening on port 3000');
        })
    })
  .catch(err=>console.log(err));

const PORT = 3000
//Learn : (custom routes,different middlewares,librariesfornode,error handeling)

//middleware to interpret JSON as JS
app.use(express.json());


//get all users with pagination
app.get('/api/users',async(req,res)=>{
    try{
        let {page,limit} = req.query; 
        if(!page)page = 1;
        if(!limit)limit=10;
        const elementsToBeSkipped = (page-1)*limit;
        const users = await User.find().limit(limit).skip(elementsToBeSkipped);
        res.status(200).json({page:page,limit:limit,users});
    }
    catch(error){
        res.status(500).json({message:error.message});
    }
})

// GET/api/users/:id - get user by ID
app.get('/api/users/:id',async(req,res)=>{
    try{
        const {id} = req.params;
        try{
            console.log(id);
            let userPresentInRedis = await redisClient.get(id);
            //cache hit(user present in redis)
            if(userPresentInRedis){ 
                {   
                    console.log('getting user from redis');
                    let user = JSON.parse(userPresentInRedis);
                    await redisClient.setEx(id,300,userPresentInRedis);
                    res.status(200).json(user);
                }
            }
            //cache miss(user not Present in redis)
            else{
                try{
                    console.log('adding user to redis');
                    let user = await User.findById(id);
                    userToPushInRedis = JSON.stringify(user);
                    redisClient.set(id,userToPushInRedis,{EX:300});   
                    res.status(200).json(user);
                }
                catch(error){
                    res.status(500).json({message:`Error in finding mongodb or setting redis:: ${error.message} `});
                }
            }
        } 
        catch(error){
            res.status(500).json({message:`Error in getting from redis:: ${error.message} `});
        }
        
    }
    catch(error){
        res.status(500).json({message:error.message});
    }
})

//update
app.put('/api/users/update/:id',async(req,res)=>{
    try{
        const {id} = req.params;
        const user = await User.findByIdAndUpdate(id,req.body,{new:true});
        let userId = id;
        if(!user){
            console.log(`No user with given Id: ${id}`);
            res.status(200).json({message:"user does not exist with given Id"});
        }
        try{
            console.log('checking if user exist in elastic');
            let userExistInElastic = await elasticClient.exists({index:"users",id:id}); //check if user is present in Elastic
            // let response = await elasticClient.get({index:'users',id});
            if(userExistInElastic){
                let elasticUser = await elasticClient.update({index:"users",id:userId,body:{doc:req.body}});
                console.log("user updated in Elastic");
                console.log("user updated successfully"); 
            }
            else console.log("user doesn't exist in Elastic");
            let userPresentInRedis = redisClient.exists(id)
            .then((async(reply)=>{
                if(reply){
                    console.log('user is present in redis so also updating user in redis');
                    try{
                        userToPushInRedis = JSON.stringify(user);
                        await redisClient.set(id,userToPushInRedis,{EX:300});
                    }
                    catch{(err)=>console.log(`Redis updation Error::: ${err}`)};
                }
            }));
            
        }
        catch{err=>res.status(500).json({message:`user updation Erorr:::${err}`})};
        res.status(200).json({message:'user updated succesfully',user:user});
    }
    catch(error){
        res.status(500).json({message:error.message});
    }
})

app.delete('/api/users/:id',async(req,res)=>{
    try{
        const {id} = req.params;
        if(!id){
            res.status(200).json({message:"No Entry with given Id please check ID again"});
        }
        let userExistsInRedis = redisClient.exists(id)
        .then(async(reply)=>{
            if(reply){
                console.log("yes user exists in redis and is being deleted");
                await redisClient.del(id); 
            }
            try{
                let user = await User.findByIdAndDelete(id);
                if(!user){
                    res.status(200).json({message:"User doesn't exist with given id or is already deleted."});
                }
                try{
                    let userExistInElastic = elasticClient.exists({index:"users",id:id}); //check if user is present in Elastic
                    if(userExistInElastic){
                        let user = await elasticClient.delete({index:'users',id:id});   
                    }
                    else console.log("user doesn't exist in Elastic");
                    res.status(200).json({message:'user removed succesfully',user:user});
                }
                catch{err=>res.status(200).json({message:`user deletion Erorr:::${err}`})};
            }
            catch(err){
                res.status(500).json({message:`Error in deleting user from DB::: ${err}`});
            }
            
        })
        .catch(err=>res.status(500).json({message:`catch:::${err}`}));
    }
    catch(error){
        res.status(500).json({message:`deletion unsuccessful:: ${error.message}`});
    }
})



//setting up rabbitmq
let amqpConn;
let channelMongoToElastic;
let exchange = "userCreate";
let routingKey = "userCreateKey";
let userQueue = "userQueue";
 async function setUpRabbitMQ(){
    amqpConn = await amqp.connect('amqp://localhost');
    channelMongoToElastic = await amqpConn.createChannel();
    channelMongoToElastic.assertExchange(exchange,'direct',{durable:true}).catch(console.error);
    channelMongoToElastic.assertQueue(userQueue,{durable:true});
    channelMongoToElastic.bindQueue(userQueue,exchange,routingKey);
 }
 setUpRabbitMQ();

app.post('/api/users/create',async(req,res)=>{
    try{
        let user = await User.create(req.body);
        console.log('inserted user in mongo');
        let userId = user._id.toString();
        console.log('sending:::');
        console.log(user);

        //publish user add request to elastic
        await channelMongoToElastic.publish(exchange,routingKey,Buffer.from(JSON.stringify(
            {index:'users',
            id:userId,
            body:req.body}
        )));

        //consume request with user data
        channelMongoToElastic.consume(userQueue,async(data)=>{
            console.log("reached in updation part");
            let userData =  JSON.parse(data.content.toString());
            console.log(userData);
            try{
                let elasticUser = await elasticClient.index(userData);
                console.log("user added to elastic search");
                res.status(200).json({message:"user added successfully",user:"elasticUser"});
            }
            catch{err=>res.status(500).json({message:err})};
        },{noAck:true});
       
        res.status(200).json({message:"user Added Successfully",user:user});
    }
    catch{(err=>res.status(500).json({message:err}));}
})

app.get('/api/search',async(req,res)=>{
    try{
        let page = 1;
        let limit = 20;
        if(req.query['page']) page =parseInt(req.query['page']);
        if(req.query['limit'])limit=parseInt(req.query['limit']);
        let from = (page-1)*limit;
        let searchFilters = [];
        let userDataFields = ["firstName","lastName","occupation","workLocation"];
        let substringSearchClauses = [];
        userDataFields.forEach(element => {
            if(req.query[element]){
                substringSearchClauses.push(
                    {wildcard:
                        {
                            [`${element}.keyword`]:{
                                value:`*${req.query[element]}*`
                            }
                        }
                    }
                );
                searchFilters.push({match:{[element]:req.query[element]}});  //if we want to search any user by providing exact filters.
            }
        });
        // console.log(substringSearchClauses);
        // console.log(searchFilters);
        let searchByKeywordQuery = {
            index:'users',
            body:{
            query:{
                bool:{
                    must: substringSearchClauses
                }
            }
            },
            from:from,
            size:limit
        };
        try{
            let queryResponse = await elasticClient.search(searchByKeywordQuery);
            // console.log(queryResponse);
            // console.log(queryResponse.hits);
            if(queryResponse
                && queryResponse.hits
                && queryResponse.hits.hits
            ){
                let filteredUsers = queryResponse.hits.hits.map((hit)=>hit._source);
                res.status(200).json({page:page,limit:limit,filteredUsers:filteredUsers});
            }
            else{
                res.status(200).json({message:"No user found"});
            }
        }
        catch{(err)=>{res.status(500).json({message:`error::::${err}`});}};
        // console.log(searchFilters);
    }
    catch(error){
        res.status(500).json({message:error.message});
    }
})




//to check working elastic some general APIs

//app.post('/elastic/post',(req,res)=>{
    //     // let userID = JSON.parse(req.body);
    //     // console.log(userID);
    //     let user = elasticClient.index({
    //         index:'users',
    //         id:1,
    //         body:req.body
    //     });
    //     res.status(200).json("elastic post API check");
    // })

     //elastic
// app.get("/test",async(req,res)=>{
//     const result = await elasticClient.get({
//         index:'users',
//         query:{
//             match: {name:"Jitin"}
//         }
//     });
//     // console.log(result);
//     res.status(200).json(result);
// });
