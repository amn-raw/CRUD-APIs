const mongoose = require('mongoose')

// const userSchema = mongoose.Schema(
//     {
//         firstName: {
//             type:String,
//             required:true     
//         }
//     }
// )

const userSchema = new mongoose.Schema(
    {
        firstName:{
            type:String,
            required:[true,"Please Enter Name"]
        },
        lastName:{
            type:String
        },
        age:{
            type:Number,
            required:true
        },
        occupation:{
            type:String,
            required:true
        },
        workLocation:{
            type:String,
            required:true
        }
    },
    {
        timestamps:true
    }
)

const User = mongoose.model('User',userSchema);

module.exports = User;