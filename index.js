const { UserInputError, AuthenticationError, ApolloServer, gql } = require('apollo-server')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const jwt = require('jsonwebtoken')
const {PubSub} = require('apollo-server')
const pubsub = new PubSub()

const JWT_SECRET = 'SECRETKEY'


mongoose.set('useFindAndModify', false)
mongoose.set('useUnifiedTopology', true)
mongoose.set('useCreateIndex', true)
const MONGODB_URI = 'mongodb+srv://changed:changedFromOriginal@cluster0-vkbs6.mongodb.net/librarygraphQL?retryWrites=true'

console.log('connecting to', MONGODB_URI)
mongoose.connect(MONGODB_URI, {useNewUrlParser:true}).then(()=> {
  console.log('connected to MongoDB')
})
.catch((error) => {
  console.log('error connection to MongoDB:', error.message)
})


const typeDefs = gql`

  type Subscription{
    bookAdded: Book!
  }

  type User{
    username: String!
    favoriteGenre: String!
    id: ID!
  }
  type Token{
    value: String!
  }




  type Query {
      bookCount(name: String): Int!
      authorCount: Int!
      allBooks(author:String, genre: String): [Book!]!
      allAuthors:[Authors!]!
      me:User
  }
  type Book {
      title: String!
      author: Authors!
      published: Int!
      genres: [String]!
      id: ID!
  }

  type Authors {
      name: String!
      born: Int
      bookCount: Int
      id:ID!
  }
  type Mutation {
    createUser(
      username:String!
      favoriteGenre: String!
    ): User
    login(
      username:String!
      password:String!
    ): Token
      addBook (
          title: String!
          author: String!
          published: Int!
          genres: [String!]!
       ): Book
    editAuthor(
        name:String!
        born:Int!
    ): Authors

  }

`

const resolvers = {
  Query: {
        bookCount: (root, args) =>{
            return Book.collection.countDocuments()
        },
        authorCount: () => Author.collection.countDocuments(),
        allBooks: async (root, args) => { 
          let result;
          result = Book.find({}).populate('author')
          if (args.genre){
            result = Book.find({
              genres:{$in:[args.genre]}
            }).populate('author')
            return result
          }else{
            result = Book.find({}).populate('author')
            return result

          }

        },
        allAuthors: () =>{
            return Author.find({})
        },
        me: (root, args, context) => {
          return context.currentUser
        }
  },
  Authors: {
      bookCount: async (root) => {
          let bookList = await Book.find({author:root.id})
          return bookList.length
      }
  },
  Mutation: {
    createUser: (root,args) => {
      const user = new User({username: args.username, favoriteGenre: args.favoriteGenre})

      return user.save()
        .catch(error =>{
          throw new UserInputError(error.message, {
            invalidArgs:args,
          })
        })
    },
    login: async(root,args) => {
      const user = await User.findOne({ username: args.username })
      if (!user || args.password !== 'nani'){
        throw new UserInputError("Wrong credentials")
      }
      const userForToken = {
        username: user.username,
        id: user._id
      }
      return {value: jwt.sign(userForToken, JWT_SECRET)}
    },
    addBook: async (root, args, {currentUser}) => {
        if(!currentUser){
          throw new AuthenticationError("Not authenticateD!!")
        }

        let author = await Author.findOne({name: args.author})
        if (!author){
          try{
            let newAuthor = new Author({name: args.author, born: null})
            let savedAuthor = await newAuthor.save()
            author = savedAuthor 
          } catch(error){
            throw new UserInputError(error.message, {
              invalidArgs: args,
            })
          }

        }
        const newBook = new Book({...args, author: author._id})
        try{
          await newBook.save()
        } catch (error){
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
        
        let newObj = {...args, author: {name: author.name, born: author.born}}
        pubsub.publish('BOOK_ADDED',{ bookAdded: newObj})
        return newObj
        
    },
    editAuthor: async (root, args, {currentUser}) => {
      if(!currentUser){
        throw new AuthenticationError("Not authenticated!!")
      }
        const chgAuthor = await Author.findOneAndUpdate({name: args.name}, {born:args.born}, {new: true})
        return chgAuthor
    }
  },
  Subscription: {
    bookAdded:{
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({req}) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith('bearer ')){
    const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET)
    const currentUser = await User.findById(decodedToken.id)
    return {currentUser}
  }}
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})
